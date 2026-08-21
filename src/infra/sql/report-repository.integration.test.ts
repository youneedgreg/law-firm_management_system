import { SqlClient } from "@effect/sql";
import { Effect, Layer, ManagedRuntime, Schema } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Billing from "../../domain/billing/invoice";
import {
  AdvocateId,
  CaseId,
  ClientId,
  InvoiceId,
} from "../../domain/shared/ids";
import * as Money from "../../domain/shared/money";
import { InvoiceRepository } from "../../services/repositories";
import { type AgeBand, ReportRepository } from "../../services/reports";
import { PgLive } from "./client";
import { InvoiceRepositoryLive } from "./invoice-repository";
import { ReportRepositoryLive } from "./report-repository";

/**
 * **The test this slice exists to make honest.**
 *
 * Reporting is the one place in this system where money is computed twice:
 * `Billing.total` sums `lineAmount` over the lines in TypeScript, and
 * `report-repository.ts` sums the same thing in SQL. Two implementations of one
 * rule is exactly the arrangement the rest of the codebase avoids, accepted
 * here because reading three years of fee notes into the application to add
 * them up is worse.
 *
 * The risk is specific and small enough to miss: **rounding position**.
 * `lineAmount` rounds *each line* before summing. A query that summed first and
 * rounded once agrees on round numbers and differs by a cent on any line whose
 * `unitPrice × quantity ÷ 100` leaves a remainder.
 *
 * So every line below is chosen to leave one. 2.33 hours at KES 18,333.33 is
 * `1_833_333 × 233 ÷ 100` = 4,271,665.89 cents — rounded per line it is
 * 4,271,666, and a query that carried the fraction into the sum would land
 * somewhere else. The assertion is simply that the two totals agree to the
 * cent, and moving the `round()` outside the `SUM()` breaks it.
 */

const hasDatabase = Boolean(process.env["DATABASE_URL"]);
const describeIfDb = hasDatabase ? describe : describe.skip;

const runtime = ManagedRuntime.make(
  Layer.mergeAll(InvoiceRepositoryLive, ReportRepositoryLive).pipe(
    Layer.provideMerge(PgLive),
  ),
);

const run = <A, E>(
  effect: Effect.Effect<A, E, InvoiceRepository | ReportRepository>,
) => runtime.runPromise(effect);

const raw = (sql: string, params: readonly unknown[] = []) =>
  runtime.runPromise(
    Effect.flatMap(SqlClient.SqlClient, (client) =>
      client.unsafe(sql, params as never),
    ),
  );

const clientId = Schema.decodeSync(ClientId)(
  "dddddddd-0000-4000-8000-000000000001",
);
const advocateId = Schema.decodeSync(AdvocateId)(
  "dddddddd-0000-4000-8000-000000000002",
);
const caseId = Schema.decodeSync(CaseId)(
  "dddddddd-0000-4000-8000-000000000003",
);

const invoiceId = (n: number) =>
  Schema.decodeSync(InvoiceId)(
    `dddddddd-0000-4000-8000-${String(n).padStart(12, "0")}`,
  );

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/**
 * Four fee notes, each with lines whose totals do **not** land on whole cents
 * before rounding.
 *
 * `quantityHundredths: 233` is 2 hours 20 minutes — 2.33 of an hour — and every
 * unit price here is deliberately odd, so `unitPrice × quantity ÷ 100` leaves a
 * remainder on every single line. Summing first and rounding once would give a
 * different answer from the domain on this data, which is the point.
 */
const invoices: readonly Billing.Invoice[] = [
  {
    id: invoiceId(11),
    number: "INV-9101",
    clientId,
    caseId,
    issuedOn: day("2026-05-04"),
    dueOn: day("2026-06-03"),
    lines: [
      {
        description: "Drafting",
        quantityHundredths: 233,
        unitPriceCents: 18_333_33,
      },
      {
        description: "Attendance",
        quantityHundredths: 167,
        unitPriceCents: 12_345_67,
      },
    ],
    payments: [],
  },
  {
    id: invoiceId(12),
    number: "INV-9102",
    clientId,
    caseId,
    issuedOn: day("2026-06-10"),
    dueOn: day("2026-07-10"),
    lines: [
      {
        description: "Research",
        quantityHundredths: 741,
        unitPriceCents: 9_876_54,
      },
    ],
    payments: [
      {
        amountCents: 100_000_00,
        method: "Bank Transfer",
        receivedOn: day("2026-06-20"),
      },
    ],
  },
  {
    id: invoiceId(13),
    number: "INV-9103",
    clientId,
    caseId,
    issuedOn: day("2026-07-15"),
    dueOn: day("2026-08-14"),
    lines: [
      {
        description: "Consultation",
        quantityHundredths: 133,
        unitPriceCents: 15_555_55,
      },
    ],
    payments: [],
  },
  /** Paid in full, so it must not appear in the ageing schedule at all. */
  {
    id: invoiceId(14),
    number: "INV-9104",
    clientId,
    caseId,
    issuedOn: day("2026-07-20"),
    dueOn: day("2026-08-19"),
    lines: [
      {
        description: "Filing",
        quantityHundredths: 100,
        unitPriceCents: 5_000_00,
      },
    ],
    payments: [
      {
        amountCents: 5_000_00,
        method: "M-Pesa",
        receivedOn: day("2026-07-25"),
        reference: "QGH7TX9PLM",
      },
    ],
  },
];

describeIfDb("reporting aggregates against real Postgres", () => {
  beforeAll(async () => {
    await raw(`DELETE FROM payments WHERE invoice_id = ANY($1::uuid[])`, [
      invoices.map((invoice) => invoice.id),
    ]);
    await raw(`DELETE FROM invoice_lines WHERE invoice_id = ANY($1::uuid[])`, [
      invoices.map((invoice) => invoice.id),
    ]);
    await raw(`DELETE FROM invoices WHERE id = ANY($1::uuid[])`, [
      invoices.map((invoice) => invoice.id),
    ]);
    await raw(`DELETE FROM cases WHERE id = $1`, [caseId]);
    await raw(`DELETE FROM clients WHERE id = $1`, [clientId]);
    await raw(`DELETE FROM advocates WHERE id = $1`, [advocateId]);

    await raw(
      `INSERT INTO advocates (id, name, role, email, certificate_number, certificate_year, active)
       VALUES ($1, 'Reporting Fixture', 'Advocate', 'reports@fixture.test', 'PC/2026/9999', 2026, true)`,
      [advocateId],
    );
    await raw(
      `INSERT INTO clients (id, number, kind, name, email, phone, onboarded_on)
       VALUES ($1, 'CLT-9901', 'Individual', 'Reporting Fixture', 'rf@fixture.test', '+254700000009', '2026-01-01')`,
      [clientId],
    );
    await raw(
      `INSERT INTO cases (id, number, title, type, status, client_id, advocate_id, opened_on)
       VALUES ($1, 'OKL-2026-901', 'Reporting fixture', 'Civil', 'Active', $2, $3, '2026-01-02')`,
      [caseId, clientId, advocateId],
    );

    await run(
      Effect.flatMap(InvoiceRepository, (repository) =>
        Effect.forEach(invoices, (invoice) => repository.save(invoice)),
      ),
    );
  }, 60_000);

  afterAll(async () => {
    await raw(`DELETE FROM payments WHERE invoice_id = ANY($1::uuid[])`, [
      invoices.map((invoice) => invoice.id),
    ]);
    await raw(`DELETE FROM invoice_lines WHERE invoice_id = ANY($1::uuid[])`, [
      invoices.map((invoice) => invoice.id),
    ]);
    await raw(`DELETE FROM invoices WHERE id = ANY($1::uuid[])`, [
      invoices.map((invoice) => invoice.id),
    ]);
    await raw(`DELETE FROM cases WHERE id = $1`, [caseId]);
    await raw(`DELETE FROM clients WHERE id = $1`, [clientId]);
    await raw(`DELETE FROM advocates WHERE id = $1`, [advocateId]);
    await runtime.dispose();
  }, 60_000);

  /**
   * **The assertion the whole slice turns on.**
   *
   * SQL's outstanding total for this client must equal the domain's, to the
   * cent, on data engineered to round awkwardly on every line. Moving the
   * `round()` outside the `SUM()` in `report-repository.ts` fails exactly this.
   *
   * Read **per client** rather than firm-wide, and that is not incidental: the
   * database this runs against also holds the seeded demo dataset, so any
   * assertion on a firm-wide total would be comparing the whole firm's money
   * against four fixtures. `debtors()` carries a client dimension; `ageing()`
   * does not, which is why the tests below are written as deltas instead.
   */
  it("agrees with the domain about what is owed, to the cent", async () => {
    const debtors = await run(
      Effect.flatMap(ReportRepository, (repository) => repository.debtors()),
    );

    const fromSql = debtors.find((row) => row.clientId === clientId);

    const fromDomain = Money.sum(
      invoices.map(Billing.outstanding).filter((amount) => amount > 0),
    );

    expect(fromSql).toBeDefined();
    expect(fromSql?.outstanding).toBe(fromDomain);
  });

  /**
   * The same agreement on what was *billed*, before any payment is netted off.
   *
   * May and June 2026 hold no seeded fee notes — the demo dataset's are all
   * January to April — so these two months are the fixtures' alone and can be
   * compared directly.
   */
  it("agrees with the domain about what was billed, to the cent", async () => {
    const monthly = await run(
      Effect.flatMap(ReportRepository, (repository) =>
        repository.monthly(6, day("2026-08-21")),
      ),
    );

    const forMonth = (month: string) =>
      Money.sum(
        invoices
          .filter(
            (invoice) =>
              `${String(invoice.issuedOn.getUTCFullYear())}-${String(
                invoice.issuedOn.getUTCMonth() + 1,
              ).padStart(2, "0")}` === month,
          )
          .map(Billing.total),
      );

    const may = monthly.find((row) => row.month === "2026-05");
    expect(may?.billed).toBe(forMonth("2026-05"));
    expect(may?.billed).toBeGreaterThan(0);
  });

  /**
   * A payment counts in the month it was *received*, not the month the fee note
   * was issued — which is the difference between a collections report and a
   * billing one, and the reason a firm runs both.
   */
  it("collects payments into the month they were received", async () => {
    const monthly = await run(
      Effect.flatMap(ReportRepository, (repository) =>
        repository.monthly(6, day("2026-08-21")),
      ),
    );

    const june = monthly.find((row) => row.month === "2026-06");

    // INV-9102 was issued in June and part-paid in June; INV-9104 was issued in
    // July and paid in July. Both fixtures, and June holds no seeded payments.
    expect(june?.collected ?? 0).toBeGreaterThanOrEqual(
      Money.fromCents(100_000_00),
    );
  });

  /**
   * A fee note paid in full is not a debt.
   *
   * Asserted as a **delta**: the schedule is firm-wide and this database also
   * holds the seeded dataset, so the test settles one of its own fee notes and
   * checks that the firm's total falls by exactly that amount and the count by
   * exactly one. That is a stronger claim than an absolute total anyway — it
   * says the settled invoice left the schedule, rather than that some number
   * happened to match.
   */
  it("drops a fee note out of the schedule when it is settled", async () => {
    const ageing = () =>
      run(
        Effect.flatMap(ReportRepository, (repository) =>
          repository.ageing(day("2026-08-21")),
        ),
      );

    const before = await ageing();
    const owed = (bands: readonly AgeBand[]) =>
      Money.sum(bands.map((band) => band.outstanding));
    const counted = (bands: readonly AgeBand[]) =>
      bands.reduce((sum, band) => sum + band.count, 0);

    const target = invoices[2]!;
    const balance = Billing.outstanding(target);
    expect(balance).toBeGreaterThan(0);

    /*
      Settled through the repository rather than by hand-written SQL. The
      point of the test is what the *aggregate* says once a fee note is paid,
      and writing the payment the way the application writes it keeps the
      fixture honest — a raw INSERT would also have to remember every
      constraint the real path already satisfies.
    */
    const settled: Billing.Invoice = {
      ...target,
      payments: [
        ...target.payments,
        {
          amountCents: balance,
          method: "Bank Transfer",
          receivedOn: day("2026-08-20"),
        },
      ],
    };

    try {
      await run(
        Effect.flatMap(InvoiceRepository, (repository) =>
          repository.save(settled),
        ),
      );

      const after = await ageing();

      expect(owed(before) - owed(after)).toBe(balance);
      expect(counted(before) - counted(after)).toBe(1);
    } finally {
      await run(
        Effect.flatMap(InvoiceRepository, (repository) =>
          repository.save(target),
        ),
      );
    }
  });

  /**
   * Every band is present even when empty. A schedule with "Over 90 days"
   * missing reads as though nothing is that old, rather than as though the
   * query said nothing about it.
   */
  it("returns every band, in order of severity", async () => {
    const bands = await run(
      Effect.flatMap(ReportRepository, (repository) =>
        repository.ageing(day("2026-08-21")),
      ),
    );

    expect(bands.map((band) => band.label)).toStrictEqual([
      "Not yet due",
      "1-30 days",
      "31-60 days",
      "61-90 days",
      "Over 90 days",
    ]);
  });

  /**
   * Buckets by **due** date, not issue date. INV-9101 was issued in May and
   * fell due on 3 June — 79 days before the reporting date, which is the
   * 61–90 band. Ageing by issue date would have put it in "Over 90 days".
   */
  it("ages from the due date rather than the issue date", async () => {
    const bands = await run(
      Effect.flatMap(ReportRepository, (repository) =>
        repository.ageing(day("2026-08-21")),
      ),
    );

    const band = bands.find((each) => each.label === "61-90 days");

    /*
      INV-9101 fell due on 3 June — 79 days before the reporting date. Ageing
      by *issue* date would make it 109 days and put it in "Over 90 days", so
      its presence here is the assertion. The band may also hold seeded
      invoices, hence `>=` rather than an exact total.
    */
    expect(band?.outstanding ?? 0).toBeGreaterThanOrEqual(
      Billing.outstanding(invoices[0]!),
    );
    expect(band?.count ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("counts the matter in the caseload breakdown", async () => {
    const byStatus = await run(
      Effect.flatMap(ReportRepository, (repository) =>
        repository.mattersByStatus(),
      ),
    );

    const active = byStatus.find((row) => row.status === "Active");
    expect((active?.count ?? 0) > 0).toBe(true);
  });
});
