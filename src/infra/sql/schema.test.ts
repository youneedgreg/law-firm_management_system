import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
      "audit_log",
      "cases",
      "client_contacts",
      "clients",
      "document_versions",
      "documents",
      "hearings",
      "invoice_lines",
      "invoices",
      "payments",
      "sessions",
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
    VALUES (gen_random_uuid(), 'OKL-2026-${Math.floor(Math.random() * 900 + 100)}',
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
 * Migration 0004 widened the phone constraint from mobile-only to any Kenyan
 * number. What matters is that it widened rather than opened: a landline is
 * accepted now, and a mistyped trunk prefix still is not.
 */
describe("phone numbers", () => {
  const insertClient = (phone: string) => `
    INSERT INTO clients (id, number, kind, name, email, phone, onboarded_on)
    VALUES (gen_random_uuid(), 'CLT-${Math.floor(Math.random() * 9000 + 1000)}',
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
    VALUES (gen_random_uuid(), 'OKL-2026-${Math.floor(Math.random() * 900 + 100)}',
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
