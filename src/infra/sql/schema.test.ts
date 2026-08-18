import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { statements } from "./migrations/0001_initial_schema";

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

  for (const statement of statements) {
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
      "advocates",
      "cases",
      "client_contacts",
      "clients",
      "document_versions",
      "documents",
      "hearings",
      "invoice_lines",
      "invoices",
      "payments",
      "time_entries",
      "trust_movements",
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
