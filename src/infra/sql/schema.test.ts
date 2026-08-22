import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUDITED_ENTITIES, AUDIT_ACTIONS } from "../../domain/audit/entry";
import { allStatements } from "./migrations";

/**
 * The schema, applied to a real Postgres and then attacked.
 *
 * PGlite is Postgres 18 compiled to WebAssembly, running in-process. That means
 * the DDL here is executed rather than merely written — including the plpgsql
 * trigger — with no Docker daemon and no container to wait for. The whole file
 * runs in about a second.
 *
 * These are not a substitute for the Testcontainers work in Phase 12, which
 * exercises the real driver, connection pooling, and `@effect/sql` on top. They
 * cover a different and cheaper thing: whether the constraints actually reject
 * what they claim to reject.
 *
 * Every test below tries to write something the domain forbids. A constraint
 * nobody has attacked is a constraint nobody knows works.
 */

let db: PGlite;

const advocate = "11111111-1111-4111-8111-111111111111";
const client = "22222222-2222-4222-8222-222222222222";

/** Runs a statement and reports whether Postgres refused it. */
const refuses = async (sql: string): Promise<boolean> => {
  try {
    await db.query(sql);
    return false;
  } catch {
    return true;
  }
};

beforeAll(async () => {
  db = await PGlite.create();

  for (const statement of allStatements) {
    await db.exec(statement);
  }

  await db.exec(`
    INSERT INTO advocates (id, name, role, email, certificate_number, certificate_year, active)
    VALUES ('${advocate}', 'Sarah Wanjiru', 'Advocate', 'sarah@example.co.ke', 'PC/2026/0041', 2026, true);

    INSERT INTO clients (id, number, kind, name, email, phone, onboarded_on)
    VALUES ('${client}', 'CLT-1001', 'Individual', 'Wanjiku Mwangi',
            'wanjiku@example.co.ke', '+254722445109', '2026-01-10');
  `);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("the schema applies at all", () => {
  it("creates every table the domain needs", async () => {
    const result = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name`,
    );

    expect(result.rows.map((row) => row.table_name)).toStrictEqual([
      "accounts",
      "advocates",
      "appointments",
      "audit_log",
      "auth_attempts",
      "cases",
      "client_contacts",
      "clients",
      "contacts",
      "document_versions",
      "documents",
      "hearings",
      "invoice_lines",
      "invoices",
      "messages",
      "payments",
      "precedents",
      "sessions",
      "tasks",
      "time_entries",
      "trust_movements",
      "users",
      "verifications",
    ]);
  });

  it("stores money as bigint, never a float type", async () => {
    const result = await db.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name LIKE '%_cents'`,
    );

    expect(result.rows.length).toBeGreaterThan(0);
    for (const row of result.rows) {
      expect(row.data_type).toBe("bigint");
    }
  });
});

/**
 * Unique-by-construction references, replacing a `Math.random()` that was a
 * flake with a measurable rate.
 *
 * `cases.number` and `clients.number` are both `UNIQUE`, and both helpers used
 * to draw a random value from a small space — three digits for a matter, which
 * is 900 possibilities across at least ten inserts in this file. That is a
 * **4.9% chance per run** of two colliding, and a collision does not look like
 * a collision: the insert is refused, `refuses()` returns `true`, and whichever
 * test expected an *accepted* insert fails claiming a constraint rejected
 * something legal. It sat in the suite from Phase 2 until a push drew the
 * losing number, which is precisely the shape §7's "no flakes" exists to
 * forbid — a test that fails one run in twenty for a reason unrelated to the
 * code teaches people to press the button again.
 *
 * A counter cannot collide, and starts clear of the fixed references this file
 * also inserts (`OKL-2026-777`, `-778`, `-999`; `CLT-1001`–`1004`, `2999`,
 * `9001`), which the format's own width leaves room for.
 */
let nextMatter = 100;
let nextClient = 3000;

const matterNumber = () => `OKL-2026-${String(nextMatter++)}`;
const clientNumber = () => `CLT-${String(nextClient++)}`;

describe("client constraints", () => {
  it("refuses a client number in the wrong format", async () => {
    expect(
      await refuses(`
        INSERT INTO clients (id, number, kind, name, email, phone, onboarded_on)
        VALUES (gen_random_uuid(), '1001', 'Individual', 'X',
                'x@example.co.ke', '+254722445109', '2026-01-10')`),
    ).toBe(true);
  });

  it("refuses a non-Kenyan phone number", async () => {
    expect(
      await refuses(`
        INSERT INTO clients (id, number, kind, name, email, phone, onboarded_on)
        VALUES (gen_random_uuid(), 'CLT-1002', 'Individual', 'X',
                'x@example.co.ke', '+447700900000', '2026-01-10')`),
    ).toBe(true);
  });

  it("refuses an individual holding an entity PIN", async () => {
    // The same rule as Client.checkPin, enforced where an import cannot skip it.
    expect(
      await refuses(`
        INSERT INTO clients (id, number, kind, name, email, phone, kra_pin, onboarded_on)
        VALUES (gen_random_uuid(), 'CLT-1003', 'Individual', 'X',
                'x@example.co.ke', '+254722445109', 'P012345678Z', '2026-01-10')`),
    ).toBe(true);
  });

  it("accepts an individual with a matching PIN", async () => {
    expect(
      await refuses(`
        INSERT INTO clients (id, number, kind, name, email, phone, kra_pin, onboarded_on)
        VALUES (gen_random_uuid(), 'CLT-1004', 'Individual', 'X',
                'x@example.co.ke', '+254722445109', 'A012345678Z', '2026-01-10')`),
    ).toBe(false);
  });
});

describe("case constraints", () => {
  const insertCase = (columns: string, values: string) => `
    INSERT INTO cases (id, number, title, type, status, client_id, advocate_id, opened_on${columns})
    VALUES (gen_random_uuid(), '${matterNumber()}',
            'A v B', 'Civil', 'New', '${client}', '${advocate}', '2026-02-14'${values})`;

  it("refuses a magistrates' court with no rank", async () => {
    expect(
      await refuses(
        insertCase(
          ", court_kind, court_station",
          ", 'MagistratesCourt', 'Milimani'",
        ),
      ),
    ).toBe(true);
  });

  it("refuses a superior court carrying a magistrate's rank", async () => {
    // Otherwise a row can claim the High Court is presided over by a Resident
    // Magistrate, and the pecuniary check downstream believes it.
    expect(
      await refuses(
        insertCase(
          ", court_kind, court_station, court_rank",
          ", 'HighCourt', 'Milimani', 'Resident Magistrate'",
        ),
      ),
    ).toBe(true);
  });

  it("accepts a properly specified magistrates' court", async () => {
    expect(
      await refuses(
        insertCase(
          ", court_kind, court_station, court_rank",
          ", 'MagistratesCourt', 'Milimani', 'Chief Magistrate'",
        ),
      ),
    ).toBe(false);
  });

  it("refuses a division on anything but the High Court", async () => {
    expect(
      await refuses(
        insertCase(
          ", court_kind, court_station, court_division",
          ", 'CourtOfAppeal', 'Nairobi', 'Commercial and Tax'",
        ),
      ),
    ).toBe(true);
  });

  it("refuses a cause number without a filing date", async () => {
    expect(
      await refuses(insertCase(", cause_number", ", 'HCCC E123 of 2026'")),
    ).toBe(true);
  });

  it("refuses half a limitation clock", async () => {
    expect(await refuses(insertCase(", accrued_on", ", '2026-01-01'"))).toBe(
      true,
    );
  });

  it("accepts both halves together", async () => {
    expect(
      await refuses(
        insertCase(
          ", accrued_on, limitation_basis",
          ", '2026-01-01', 'contract'",
        ),
      ),
    ).toBe(false);
  });

  it("refuses a negative claim value", async () => {
    expect(await refuses(insertCase(", claim_value_cents", ", -100"))).toBe(
      true,
    );
  });
});

describe("hearing constraints", () => {
  let caseId: string;

  beforeAll(async () => {
    const result = await db.query<{ id: string }>(`
      INSERT INTO cases (id, number, title, type, status, client_id, advocate_id, opened_on)
      VALUES (gen_random_uuid(), 'OKL-2026-999', 'A v B', 'Civil', 'New',
              '${client}', '${advocate}', '2026-02-14')
      RETURNING id`);
    caseId = result.rows[0]!.id;
  });

  const insertHearing = (columns: string, values: string) => `
    INSERT INTO hearings (id, case_id, kind, court_kind, court_station, court_rank, scheduled_for, advocate_id${columns})
    VALUES (gen_random_uuid(), '${caseId}', 'Mention', 'MagistratesCourt', 'Milimani',
            'Principal Magistrate', '2026-08-20', '${advocate}'${values})`;

  it("refuses an adjournment with nowhere to adjourn to", async () => {
    // The constraint that stops matters falling off the diary.
    expect(
      await refuses(
        insertHearing(
          ", outcome, adjourned_reason",
          ", 'Adjourned', 'Court not sitting'",
        ),
      ),
    ).toBe(true);
  });

  it("refuses an adjournment date before the hearing", async () => {
    expect(
      await refuses(
        insertHearing(
          ", outcome, adjourned_to, adjourned_reason",
          ", 'Adjourned', '2025-09-15', 'Year typed wrong'",
        ),
      ),
    ).toBe(true);
  });

  it("accepts an adjournment that moves the matter forward", async () => {
    expect(
      await refuses(
        insertHearing(
          ", outcome, adjourned_to, adjourned_reason",
          ", 'Adjourned', '2026-09-15', 'Court not sitting'",
        ),
      ),
    ).toBe(false);
  });

  it("refuses a next date on an outcome that is not an adjournment", async () => {
    expect(
      await refuses(
        insertHearing(", outcome, adjourned_to", ", 'Heard', '2026-09-15'"),
      ),
    ).toBe(true);
  });
});

describe("Rule 10, enforced by the database", () => {
  const trustClient = "33333333-3333-4333-8333-333333333333";

  beforeAll(async () => {
    await db.exec(`
      INSERT INTO clients (id, number, kind, name, email, phone, onboarded_on)
      VALUES ('${trustClient}', 'CLT-2999', 'Individual', 'Trust Probe',
              'probe@example.co.ke', '+254722445109', '2026-01-10')`);
  });

  const move = (reason: string, cents: number, forClient = trustClient) => `
    INSERT INTO trust_movements (id, client_id, reason, amount_cents)
    VALUES (gen_random_uuid(), '${forClient}', '${reason}', ${cents})`;

  it("refuses a withdrawal against an empty balance", async () => {
    expect(await refuses(move("Payment to client", 50_000_00))).toBe(true);
  });

  it("allows a deposit, then a withdrawal within it", async () => {
    expect(await refuses(move("Deposit received", 200_000_00))).toBe(false);
    expect(await refuses(move("Payment on behalf of client", 120_000_00))).toBe(
      false,
    );
  });

  it("refuses a withdrawal one cent beyond the remaining balance", async () => {
    // 80,000.00 remains after the previous test.
    expect(await refuses(move("Payment to client", 80_000_01))).toBe(true);
    expect(await refuses(move("Payment to client", 80_000_00))).toBe(false);
  });

  it("refuses an overdraw even when the firm holds more for other clients", async () => {
    // The case the rule exists for, now checked at the storage layer rather
    // than only in the domain.
    await db.exec(move("Deposit received", 5_000_000_00, client));

    const total = await db.query<{ sum: string }>(
      `SELECT sum(amount_cents)::text AS sum FROM trust_movements
        WHERE reason = 'Deposit received'`,
    );
    expect(Number(total.rows[0]!.sum)).toBeGreaterThan(5_000_000_00);

    expect(await refuses(move("Payment to client", 300_000_00))).toBe(true);
  });

  it("keeps every client's balance non-negative afterwards", async () => {
    const result = await db.query<{ balance_cents: string }>(
      `SELECT balance_cents::text AS balance_cents FROM client_trust_balances`,
    );

    for (const row of result.rows) {
      expect(Number(row.balance_cents)).toBeGreaterThanOrEqual(0);
    }
  });

  it("refuses a movement with a non-positive amount", async () => {
    expect(await refuses(move("Deposit received", 0))).toBe(true);
    expect(await refuses(move("Deposit received", -5000))).toBe(true);
  });
});

describe("billing constraints", () => {
  it("refuses an invoice due before it was issued", async () => {
    expect(
      await refuses(`
        INSERT INTO invoices (id, number, client_id, issued_on, due_on)
        VALUES (gen_random_uuid(), 'INV-9001', '${client}', '2026-08-31', '2026-08-01')`),
    ).toBe(true);
  });

  it("refuses a zero-value payment", async () => {
    await db.exec(`
      INSERT INTO invoices (id, number, client_id, issued_on, due_on)
      VALUES ('44444444-4444-4444-8444-444444444444', 'INV-9002', '${client}',
              '2026-08-01', '2026-08-31')`);

    expect(
      await refuses(`
        INSERT INTO payments (id, invoice_id, amount_cents, method, received_on)
        VALUES (gen_random_uuid(), '44444444-4444-4444-8444-444444444444',
                0, 'M-Pesa', '2026-08-15')`),
    ).toBe(true);
  });

  it("stores no invoice total, because the lines are the total", async () => {
    const result = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'invoices'`,
    );

    const columns = result.rows.map((row) => row.column_name);
    expect(columns).not.toContain("total_cents");
    expect(columns).not.toContain("status");
  });
});

/**
 * M-Pesa reconciliation, migration 0006.
 *
 * Two rules, and they fail for different reasons — which is the whole reason
 * both exist. The `CHECK` refuses a payment that could never be reconciled; the
 * partial unique index refuses a second payment carrying a confirmation code
 * that has already been banked. A system with only the first would happily
 * credit a client twice for one transaction.
 *
 * The `NOT VALID` qualifier on the `CHECK` is deliberately *not* exercised here
 * by seeding a bad row first. It governs only whether pre-existing rows were
 * scanned when the constraint was added; every statement below is a new write,
 * and new writes are checked. That is exactly the claim being tested.
 */
describe("M-Pesa reconciliation", () => {
  const feeNote = "55555555-5555-4555-8555-555555555555";
  const second = "66666666-6666-4666-8666-666666666666";

  beforeAll(async () => {
    await db.exec(`
      INSERT INTO invoices (id, number, client_id, issued_on, due_on)
      VALUES ('${feeNote}', 'INV-9101', '${client}', '2026-08-01', '2026-08-31'),
             ('${second}', 'INV-9102', '${client}', '2026-08-01', '2026-08-31');
    `);
  });

  it("refuses an M-Pesa payment with no confirmation code", async () => {
    expect(
      await refuses(`
        INSERT INTO payments (id, invoice_id, ordinal, amount_cents, method, received_on)
        VALUES (gen_random_uuid(), '${feeNote}', 0, 100000, 'M-Pesa', '2026-08-15')`),
    ).toBe(true);
  });

  it("refuses a reference that is not shaped like a confirmation code", async () => {
    expect(
      await refuses(`
        INSERT INTO payments (id, invoice_id, ordinal, amount_cents, method, received_on, reference)
        VALUES (gen_random_uuid(), '${feeNote}', 1, 100000, 'M-Pesa', '2026-08-15',
                'INV-9101/1')`),
    ).toBe(true);
  });

  it("accepts one, and then refuses the same code a second time", async () => {
    await db.exec(`
      INSERT INTO payments (id, invoice_id, ordinal, amount_cents, method, received_on, reference)
      VALUES (gen_random_uuid(), '${feeNote}', 2, 100000, 'M-Pesa', '2026-08-15',
              'QGH7XYZ12A')`);

    /**
     * The double post, refused — and refused *across* invoices, which is the
     * case a per-invoice constraint would miss. One M-Pesa transaction cannot
     * pay two fee notes, and the way this mistake actually happens is somebody
     * applying a forwarded confirmation to the wrong invoice a week later.
     */
    expect(
      await refuses(`
        INSERT INTO payments (id, invoice_id, ordinal, amount_cents, method, received_on, reference)
        VALUES (gen_random_uuid(), '${second}', 2, 100000, 'M-Pesa', '2026-08-16',
                'QGH7XYZ12A')`),
    ).toBe(true);
  });

  /**
   * The index is partial, and this is what that buys.
   *
   * Two cheques carrying the same client reference are ordinary. A constraint
   * over the whole column would refuse the second one to enforce a rule that
   * only applies to M-Pesa — a fake stricter than reality, in the database.
   */
  it("allows two non-M-Pesa payments to share a reference", async () => {
    await db.exec(`
      INSERT INTO payments (id, invoice_id, ordinal, amount_cents, method, received_on, reference)
      VALUES (gen_random_uuid(), '${feeNote}', 3, 50000, 'Cheque', '2026-08-17', '004821'),
             (gen_random_uuid(), '${second}', 3, 50000, 'Cheque', '2026-08-17', '004821')`);

    const result = await db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM payments WHERE reference = '004821'`,
    );

    expect(result.rows[0]?.count).toBe(2);
  });
});

/**
 * Migration 0004 widened the phone constraint from mobile-only to any Kenyan
 * number. What matters is that it widened rather than opened: a landline is
 * accepted now, and a mistyped trunk prefix still is not.
 */
describe("phone numbers", () => {
  const insertClient = (phone: string) => `
    INSERT INTO clients (id, number, kind, name, email, phone, onboarded_on)
    VALUES (gen_random_uuid(), '${clientNumber()}',
            'Corporate', 'Zenith Ltd', 'legal@zenith.co.ke', '${phone}', '2026-01-10')`;

  it("accepts a Nairobi switchboard landline", async () => {
    expect(await refuses(insertClient("+254204453021"))).toBe(false);
  });

  it("accepts a Mombasa landline", async () => {
    expect(await refuses(insertClient("+254412207743"))).toBe(false);
  });

  it("still accepts a mobile", async () => {
    expect(await refuses(insertClient("+254722445109"))).toBe(false);
  });

  it("still refuses the national trunk prefix, which E.164 never carries", async () => {
    expect(await refuses(insertClient("+2540722445109"))).toBe(true);
  });

  it.each(["+254722445", "+25472244510912", "+447700900000", "0722445109"])(
    "still refuses %o",
    async (phone) => {
      expect(await refuses(insertClient(phone))).toBe(true);
    },
  );
});

/**
 * Migration 0002 removed two ways the schema could hold something the domain
 * cannot represent. Both are attacked here for the same reason as everything
 * above: a corrected constraint nobody has tried to break is a claim, not a
 * guarantee.
 */
describe("filing dates and contact order", () => {
  const insertCase = (columns: string, values: string) => `
    INSERT INTO cases (id, number, title, type, status, client_id, advocate_id, opened_on${columns})
    VALUES (gen_random_uuid(), '${matterNumber()}',
            'A v B', 'Civil', 'New', '${client}', '${advocate}', '2026-02-14'${values})`;

  it("leaves filed_on null rather than defaulting it to the epoch", async () => {
    await db.exec(insertCase("", ""));

    const result = await db.query<{ filed_on: unknown }>(
      `SELECT filed_on FROM cases WHERE filed_on IS NOT NULL AND filed_on < DATE '1971-01-01'`,
    );

    expect(result.rows).toStrictEqual([]);
  });

  it("still refuses a cause number when nothing was filed", async () => {
    expect(
      await refuses(insertCase(", cause_number", ", 'HCCC E900 of 2026'")),
    ).toBe(true);
  });

  it("accepts a cause number once a filing date is recorded", async () => {
    expect(
      await refuses(
        insertCase(
          ", cause_number, filed_on",
          ", 'HCCC E901 of 2026', '2026-03-01'",
        ),
      ),
    ).toBe(false);
  });

  it("refuses a filing date before the matter was opened", async () => {
    expect(await refuses(insertCase(", filed_on", ", '2026-01-01'"))).toBe(
      true,
    );
  });

  it("refuses two contacts claiming the same position", async () => {
    await db.exec(`
      INSERT INTO client_contacts (id, client_id, name, role, ordinal)
      VALUES (gen_random_uuid(), '${client}', 'Grace Otieno', 'Company Secretary', 0)`);

    expect(
      await refuses(`
        INSERT INTO client_contacts (id, client_id, name, role, ordinal)
        VALUES (gen_random_uuid(), '${client}', 'Peter Kimani', 'Director', 0)`),
    ).toBe(true);
  });

  it("accepts the next position along", async () => {
    expect(
      await refuses(`
        INSERT INTO client_contacts (id, client_id, name, role, ordinal)
        VALUES (gen_random_uuid(), '${client}', 'Peter Kimani', 'Director', 1)`),
    ).toBe(false);
  });

  it("refuses a negative position", async () => {
    expect(
      await refuses(`
        INSERT INTO client_contacts (id, client_id, name, role, ordinal)
        VALUES (gen_random_uuid(), '${client}', 'Mary Njeri', 'Director', -1)`),
    ).toBe(true);
  });
});

/**
 * Identity, attacked at the database.
 *
 * Every rule below is also enforced in TypeScript — `Principal` is a union, so
 * a login that is both staff and client is not expressible, and
 * `UserRepository.provision` takes a tagged subject so it cannot write one.
 * These tests are about the *other* ways in: a migration, an import, a psql
 * session at two in the morning, and whatever Phase 7 adds. A constraint that
 * only the application enforces is a convention.
 */
describe("a login points at exactly one subject", () => {
  it("accepts a login for a member of staff", async () => {
    expect(
      await refuses(`
        INSERT INTO users (id, name, email, advocate_id)
        VALUES (gen_random_uuid(), 'Sarah Wanjiru', 'sarah@oklaw.co.ke', '${advocate}')`),
    ).toBe(false);
  });

  it("accepts a login for a client", async () => {
    expect(
      await refuses(`
        INSERT INTO users (id, name, email, client_id)
        VALUES (gen_random_uuid(), 'Wanjiku Mwangi', 'wanjiku@example.co.ke', '${client}')`),
    ).toBe(false);
  });

  /**
   * The row that would break every authorization check in the system.
   *
   * A login carrying both links is a person the code would have to *choose* how
   * to treat: staff, with the run of the firm, or a client scoped to their own
   * file. `users_exactly_one_subject` means the choice never arises.
   */
  it("refuses a login that is both staff and client", async () => {
    expect(
      await refuses(`
        INSERT INTO users (id, name, email, advocate_id, client_id)
        VALUES (gen_random_uuid(), 'Both', 'both@oklaw.co.ke', '${advocate}', '${client}')`),
    ).toBe(true);
  });

  it("refuses a login that authenticates to nobody", async () => {
    expect(
      await refuses(`
        INSERT INTO users (id, name, email)
        VALUES (gen_random_uuid(), 'Nobody', 'nobody@oklaw.co.ke')`),
    ).toBe(true);
  });

  /**
   * Two logins onto one client would both be "the client" in the audit trail,
   * and nothing afterwards could say which person acted.
   */
  it("refuses a second login for the same client", async () => {
    expect(
      await refuses(`
        INSERT INTO users (id, name, email, client_id)
        VALUES (gen_random_uuid(), 'Wanjiku again', 'second@example.co.ke', '${client}')`),
    ).toBe(true);
  });

  it("refuses a second login for the same member of staff", async () => {
    expect(
      await refuses(`
        INSERT INTO users (id, name, email, advocate_id)
        VALUES (gen_random_uuid(), 'Sarah again', 'second@oklaw.co.ke', '${advocate}')`),
    ).toBe(true);
  });

  it("refuses two logins on one email address", async () => {
    expect(
      await refuses(`
        INSERT INTO users (id, name, email, advocate_id)
        VALUES (gen_random_uuid(), 'Someone', 'sarah@oklaw.co.ke', NULL)`),
    ).toBe(true);
  });

  /**
   * A session belongs to a login and dies with it.
   *
   * `ON DELETE CASCADE` is the half of "sign everyone out" that has to be true
   * in the database: deleting a login must not leave a session that keeps
   * working until its cookie happens to expire.
   */
  it("takes a login's sessions with it when the login goes", async () => {
    const user = "33333333-3333-4333-8333-333333333333";

    await db.exec(`
      INSERT INTO clients (id, number, kind, name, email, phone, onboarded_on)
      VALUES ('44444444-4444-4444-8444-444444444444', 'CLT-9001', 'Individual',
              'Temp Client', 'temp@example.co.ke', '+254722445100', '2026-01-10');

      INSERT INTO users (id, name, email, client_id)
      VALUES ('${user}', 'Temp', 'temp@oklaw.co.ke',
              '44444444-4444-4444-8444-444444444444');

      INSERT INTO sessions (id, user_id, token, expires_at)
      VALUES (gen_random_uuid(), '${user}', 'tok-1', now() + interval '7 days');
    `);

    await db.query(`DELETE FROM users WHERE id = '${user}'`);

    const left = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM sessions WHERE user_id = '${user}'`,
    );

    expect(left.rows[0]?.count).toBe("0");
  });
});

/**
 * The audit vocabulary, in two places, asserted to be one.
 *
 * `AUDIT_ACTIONS` is a TypeScript union and `audit_action` is a Postgres enum,
 * and nothing structural keeps them in step — which is exactly how Phase 7's
 * first settlement failed: `invoice.settled` was added to the union, the enum
 * was not migrated, and the write was refused. The transaction then rolled the
 * money back with it, which is the guarantee working, but the right place to
 * catch this is here rather than in a browser.
 *
 * Written as a set comparison in both directions. An action in the union and
 * not the enum is a write that will fail; an action in the enum and not the
 * union is a value no code can produce and nothing will ever read, which is
 * dead vocabulary in the one table that is supposed to be legible in five
 * years.
 */
describe("the audit vocabulary matches the domain", () => {
  const labels = async (type: string) => {
    const result = await db.query<{ label: string }>(
      `SELECT e.enumlabel AS label
         FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = $1
        ORDER BY e.enumsortorder`,
      [type],
    );
    return result.rows.map((row) => row.label);
  };

  it("declares exactly the actions the domain can record", async () => {
    expect((await labels("audit_action")).sort()).toEqual(
      [...AUDIT_ACTIONS].sort(),
    );
  });

  it("declares exactly the entities the domain can act on", async () => {
    expect((await labels("audited_entity")).sort()).toEqual(
      [...AUDITED_ENTITIES].sort(),
    );
  });

  /**
   * And the enum still refuses what neither declares. This is what the enum is
   * *for* — a `text` column would have accepted `invoice.setled` silently, and
   * the report looking for settlements would have quietly missed one.
   */
  it("refuses an action nobody declared", async () => {
    expect(
      await refuses(`
        INSERT INTO audit_log (id, actor_name, actor_role, action, entity, entity_id)
        VALUES (gen_random_uuid(), 'Probe', 'Advocate', 'invoice.setled',
                'invoice', 'x')`),
    ).toBe(true);
  });
});

describe("the audit trail is append-only", () => {
  const entry = "55555555-5555-4555-8555-555555555555";

  it("accepts an entry", async () => {
    expect(
      await refuses(`
        INSERT INTO audit_log (id, actor_user_id, actor_name, actor_role, action, entity, entity_id, after)
        VALUES ('${entry}', NULL, 'Sarah Wanjiru', 'Advocate', 'case.opened',
                'case', '${advocate}', '{"status":"New"}'::jsonb)`),
    ).toBe(false);
  });

  /**
   * The trigger, not a permission.
   *
   * An audit trail the application can edit is a record of what somebody was
   * willing to leave behind. This does not defend against an attacker holding
   * the database owner's credentials — they can drop the trigger — but it does
   * defend against the likely thing: a cleanup script, an ORM cascade, or a
   * future service "correcting" an entry.
   */
  it("refuses an update to an entry", async () => {
    expect(
      await refuses(
        `UPDATE audit_log SET actor_name = 'Somebody else' WHERE id = '${entry}'`,
      ),
    ).toBe(true);
  });

  it("refuses a delete", async () => {
    expect(await refuses(`DELETE FROM audit_log WHERE id = '${entry}'`)).toBe(
      true,
    );
  });

  it("refuses an entry that records neither a subject nor a session event", async () => {
    expect(
      await refuses(`
        INSERT INTO audit_log (id, actor_name, actor_role, action, entity)
        VALUES (gen_random_uuid(), 'X', 'Advocate', 'case.opened', 'case')`),
    ).toBe(true);
  });

  /** A refused sign-in has no user behind it and no record it acted on. */
  it("accepts a session event with no subject", async () => {
    expect(
      await refuses(`
        INSERT INTO audit_log (id, actor_name, actor_role, action, entity)
        VALUES (gen_random_uuid(), 'someone@example.co.ke', 'Not signed in',
                'session.refused', 'user')`),
    ).toBe(false);
  });

  it("refuses an action outside the enumerated set", async () => {
    expect(
      await refuses(`
        INSERT INTO audit_log (id, actor_name, actor_role, action, entity, entity_id)
        VALUES (gen_random_uuid(), 'X', 'Advocate', 'case.deleted', 'case', 'x')`),
    ).toBe(true);
  });
});

/**
 * The task invariants, said to anything that is not this application.
 *
 * The domain's `Schema.filter` refuses a task that is `Done` with no completion
 * record — but a domain filter protects one code path, and a status column
 * beside two nullable columns is reachable from a psql prompt, a fix-up script
 * and any future service that forgets. These are what stop the row that
 * contradicts itself.
 */
describe("tasks", () => {
  let matter: string;

  beforeAll(async () => {
    const result = await db.query<{ id: string }>(`
      INSERT INTO cases (id, number, title, type, status, client_id, advocate_id, opened_on)
      VALUES (gen_random_uuid(), 'OKL-2026-777', 'Task matter', 'Civil', 'New',
              '${client}', '${advocate}', '2026-02-14')
      RETURNING id`);
    matter = result.rows[0]!.id;
  });

  const insert = (columns: string, values: string) =>
    refuses(
      `INSERT INTO tasks (id, title, assigned_to, priority, status, raised_on, due_on${columns})
       VALUES (gen_random_uuid(), 'Draft affidavit', '${advocate}', 'High'${values})`,
    );

  it("accepts open work on a matter", async () => {
    expect(
      await insert(
        ", case_id",
        ", 'Not started', '2026-08-10', '2026-08-20', '" + matter + "'",
      ),
    ).toBe(false);
  });

  /**
   * Firm work — reconciling the trust account — has no file number, and that
   * is correct rather than a gap. `time_entries.case_id` is `NOT NULL` for the
   * opposite reason: unattributed *time* is a hole in the billing record.
   */
  it("accepts firm work with no matter behind it", async () => {
    expect(
      await insert("", ", 'Not started', '2026-08-10', '2026-08-25'"),
    ).toBe(false);
  });

  it("refuses a task due before it was raised", async () => {
    expect(
      await insert("", ", 'Not started', '2026-08-10', '2025-08-25'"),
    ).toBe(true);
  });

  it("refuses Done with nothing recorded", async () => {
    expect(await insert("", ", 'Done', '2026-08-10', '2026-08-20'")).toBe(true);
  });

  it("refuses a completion record under any other status", async () => {
    expect(
      await insert(
        ", completed_on, completed_by",
        ", 'In progress', '2026-08-10', '2026-08-20', '2026-08-18', '" +
          advocate +
          "'",
      ),
    ).toBe(true);
  });

  it("refuses half a completion record", async () => {
    expect(
      await insert(
        ", completed_on",
        ", 'Done', '2026-08-10', '2026-08-20', '2026-08-18'",
      ),
    ).toBe(true);
  });

  it("accepts a whole one", async () => {
    expect(
      await insert(
        ", completed_on, completed_by",
        ", 'Done', '2026-08-10', '2026-08-20', '2026-08-18', '" +
          advocate +
          "'",
      ),
    ).toBe(false);
  });

  /**
   * A task exists to get a matter done, so if the matter is gone the task is
   * not merely unassigned — it is meaningless. Same reasoning as documents and
   * time entries, and the opposite of the audit trail, which outlives
   * everything it names.
   */
  it("takes its tasks with the matter", async () => {
    const doomed = await db.query<{ id: string }>(`
      INSERT INTO cases (id, number, title, type, status, client_id, advocate_id, opened_on)
      VALUES (gen_random_uuid(), 'OKL-2026-778', 'Doomed', 'Civil', 'New',
              '${client}', '${advocate}', '2026-02-14')
      RETURNING id`);
    const id = doomed.rows[0]!.id;

    await db.query(
      `INSERT INTO tasks (id, title, case_id, assigned_to, priority, status, raised_on, due_on)
       VALUES (gen_random_uuid(), 'Doomed task', '${id}', '${advocate}', 'Low',
               'Not started', '2026-08-10', '2026-08-20')`,
    );
    await db.query(`DELETE FROM cases WHERE id = '${id}'`);

    const left = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM tasks WHERE case_id = '${id}'`,
    );

    expect(left.rows[0]?.count).toBe("0");
  });
});

/**
 * Correspondence, and the guarantees the database itself makes about it.
 *
 * What was said to a client is part of the retainer's history. A firm that can
 * quietly revise its side of that is worse than one with no messages at all,
 * so the append-only rule is a trigger rather than a convention — the same
 * treatment the audit trail gets, and for a related reason.
 */
describe("messages", () => {
  let matter: string;
  let sent: string;

  beforeAll(async () => {
    const result = await db.query<{ id: string }>(`
      INSERT INTO cases (id, number, title, type, status, client_id, advocate_id, opened_on)
      VALUES (gen_random_uuid(), 'OKL-2030-001', 'Message matter', 'Civil', 'New',
              '${client}', '${advocate}', '2026-02-14')
      RETURNING id`);
    matter = result.rows[0]!.id;

    const message = await db.query<{ id: string }>(`
      INSERT INTO messages (id, client_id, case_id, author, body, sent_at)
      VALUES (gen_random_uuid(), '${client}', '${matter}', 'FromClient',
              'Any news on the hearing?', '2026-08-20T10:00:00Z')
      RETURNING id`);
    sent = message.rows[0]!.id;
  });

  it("accepts a message from a client, naming nobody", async () => {
    expect(
      await refuses(`
        INSERT INTO messages (id, client_id, author, body)
        VALUES (gen_random_uuid(), '${client}', 'FromClient', 'Hello')`),
    ).toBe(false);
  });

  it("accepts a message from the firm, naming the advocate", async () => {
    expect(
      await refuses(`
        INSERT INTO messages (id, client_id, author, advocate_id, body)
        VALUES (gen_random_uuid(), '${client}', 'FromFirm', '${advocate}', 'Hello')`),
    ).toBe(false);
  });

  /**
   * The tagged union, in SQL. Both halves refused, because either way round
   * the row means two things at once.
   */
  it("refuses a firm message that names nobody", async () => {
    expect(
      await refuses(`
        INSERT INTO messages (id, client_id, author, body)
        VALUES (gen_random_uuid(), '${client}', 'FromFirm', 'Hello')`),
    ).toBe(true);
  });

  it("refuses a client message that names an advocate", async () => {
    expect(
      await refuses(`
        INSERT INTO messages (id, client_id, author, advocate_id, body)
        VALUES (gen_random_uuid(), '${client}', 'FromClient', '${advocate}', 'Hello')`),
    ).toBe(true);
  });

  it("refuses an empty message", async () => {
    expect(
      await refuses(`
        INSERT INTO messages (id, client_id, author, body)
        VALUES (gen_random_uuid(), '${client}', 'FromClient', '   ')`),
    ).toBe(true);
  });

  it("refuses a message read before it was sent", async () => {
    expect(
      await refuses(`
        INSERT INTO messages (id, client_id, author, body, sent_at, read_at)
        VALUES (gen_random_uuid(), '${client}', 'FromClient', 'Hello',
                '2026-08-20T10:00:00Z', '2026-08-19T10:00:00Z')`),
    ).toBe(true);
  });

  it("refuses an edit to what was said", async () => {
    expect(
      await refuses(
        `UPDATE messages SET body = 'Something else' WHERE id = '${sent}'`,
      ),
    ).toBe(true);
  });

  it("refuses a delete", async () => {
    expect(await refuses(`DELETE FROM messages WHERE id = '${sent}'`)).toBe(
      true,
    );
  });

  /** Marking read is the one permitted update: it is not a revision. */
  it("permits marking it read", async () => {
    expect(
      await refuses(
        `UPDATE messages SET read_at = '2026-08-20T11:00:00Z' WHERE id = '${sent}'`,
      ),
    ).toBe(false);
  });

  /**
   * First read wins. Overwriting would make a message look freshly seen every
   * time somebody opened the page, and "when did you first see this" has one
   * answer.
   */
  it("refuses a second, different read time", async () => {
    expect(
      await refuses(
        `UPDATE messages SET read_at = '2026-08-25T09:00:00Z' WHERE id = '${sent}'`,
      ),
    ).toBe(true);
  });

  /**
   * Correspondence does not cascade away with the client, unlike every other
   * child table here. A system that silently discards it when somebody tidies
   * up a record cannot answer "what did you tell them, and when".
   */
  it("will not let a client with correspondence be deleted", async () => {
    expect(await refuses(`DELETE FROM clients WHERE id = '${client}'`)).toBe(
      true,
    );
  });

  /**
   * Nor does a matter with correspondence on it, and the reason is the trigger
   * above rather than tidiness.
   *
   * `case_id` was first written `ON DELETE SET NULL` — which reads as the
   * gentle option and is not: nulling the column is an *edit* to a message,
   * which the append-only trigger refuses, so the delete failed with a
   * confusing error from the trigger instead of a clear one from the
   * constraint. This test is what found that, and `RESTRICT` is what makes the
   * two agree.
   */
  it("will not let a matter with correspondence be deleted", async () => {
    const doomed = await db.query<{ id: string }>(`
      INSERT INTO cases (id, number, title, type, status, client_id, advocate_id, opened_on)
      VALUES (gen_random_uuid(), 'OKL-2030-002', 'Doomed', 'Civil', 'New',
              '${client}', '${advocate}', '2026-02-14')
      RETURNING id`);
    const id = doomed.rows[0]!.id;

    await db.query(`
      INSERT INTO messages (id, client_id, case_id, author, body)
      VALUES (gen_random_uuid(), '${client}', '${id}', 'FromClient', 'About this one')`);

    expect(await refuses(`DELETE FROM cases WHERE id = '${id}'`)).toBe(true);
  });
});

/**
 * The authentication throttle's counters.
 *
 * Two properties, both structural, both easy to lose in a later edit. The key
 * is the pair — one row per bucket per window is what makes counting a single
 * upsert rather than an aggregate — and a count cannot go below zero, which is
 * the shape of an off-by-one in the sweep that would otherwise silently hand
 * out free attempts.
 */
describe("authentication attempt counters", () => {
  const window = "2026-08-21 10:00:00+00";

  it("counts once per bucket per window", async () => {
    await db.query(`
      INSERT INTO auth_attempts (bucket, window_start, attempts)
      VALUES ('bucket-a', '${window}', 1)`);

    expect(
      await refuses(`
        INSERT INTO auth_attempts (bucket, window_start, attempts)
        VALUES ('bucket-a', '${window}', 1)`),
    ).toBe(true);
  });

  it("counts the same bucket separately in the next window", async () => {
    expect(
      await refuses(`
        INSERT INTO auth_attempts (bucket, window_start, attempts)
        VALUES ('bucket-a', '2026-08-21 10:15:00+00', 1)`),
    ).toBe(false);
  });

  it("refuses a negative count", async () => {
    expect(
      await refuses(`
        INSERT INTO auth_attempts (bucket, window_start, attempts)
        VALUES ('bucket-b', '${window}', -1)`),
    ).toBe(true);
  });

  /**
   * The upsert the repository actually runs, exercised end to end: the second
   * attempt increments rather than failing, and returns the count *including*
   * itself — which is what lets the service compare against an allowance
   * without a separate read.
   */
  it("increments on conflict and returns the count including this attempt", async () => {
    const spend = `
      INSERT INTO auth_attempts (bucket, window_start, attempts)
      VALUES ('bucket-c', '${window}', 1)
      ON CONFLICT (bucket, window_start)
        DO UPDATE SET attempts = auth_attempts.attempts + 1
      RETURNING attempts`;

    const first = await db.query<{ attempts: number }>(spend);
    const second = await db.query<{ attempts: number }>(spend);

    expect(Number(first.rows[0]!.attempts)).toBe(1);
    expect(Number(second.rows[0]!.attempts)).toBe(2);
  });
});
