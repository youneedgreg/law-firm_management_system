import { SqlClient } from "@effect/sql";
import { Effect, Exit, Layer, ManagedRuntime, Schema } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Billing from "../../domain/billing/invoice";
import {
  AdvocateId,
  ClientId,
  InvoiceId,
  TrustMovementId,
} from "../../domain/shared/ids";
import * as Money from "../../domain/shared/money";
import type * as Ledger from "../../domain/trust/ledger";
import {
  InvoiceRepository,
  TrustRepository,
} from "../../services/repositories";
import { PgLive } from "./client";
import { InvoiceRepositoryLive } from "./invoice-repository";
import { TrustRepositoryLive } from "./trust-repository";

/**
 * `InvoiceRepository` against a real Postgres, and the one operation in the
 * system that genuinely needs a transaction.
 *
 * Paying a fee note out of client money is two writes — a payment against the
 * invoice, and a withdrawal from the client's trust account — and either alone
 * is a misstatement. The database can refuse the second: Rule 10 is enforced by
 * a trigger. So the rollback path is not hypothetical here, and the test that
 * matters is the one asserting that a refused withdrawal leaves no payment row
 * behind.
 */

const hasDatabase = Boolean(process.env["DATABASE_URL"]);
const describeIfDb = hasDatabase ? describe : describe.skip;

const runtime = ManagedRuntime.make(
  Layer.mergeAll(InvoiceRepositoryLive, TrustRepositoryLive).pipe(
    Layer.provideMerge(PgLive),
  ),
);

const run = <A, E>(
  effect: Effect.Effect<A, E, InvoiceRepository | TrustRepository>,
) => runtime.runPromiseExit(effect);

const raw = <T extends object>(sql: string, params: readonly unknown[] = []) =>
  runtime.runPromise(
    Effect.flatMap(SqlClient.SqlClient, (client) =>
      client.unsafe<T>(sql, params as never),
    ),
  );

const clientId = Schema.decodeSync(ClientId)(
  "eeeeeeee-0000-4000-8000-000000000001",
);
const advocateId = Schema.decodeSync(AdvocateId)(
  "eeeeeeee-0000-4000-8000-000000000002",
);
const invoiceId = Schema.decodeSync(InvoiceId)(
  "eeeeeeee-0000-4000-8000-000000000003",
);

let sequence = 0;
const movementId = () => {
  sequence += 1;
  return Schema.decodeSync(TrustMovementId)(
    `eeee0000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
  );
};

/** KES 300,000 of fees: 2.5 hours at 20,000 plus 5 hours at 50,000. */
const invoice: Billing.Invoice = {
  id: invoiceId,
  number: "INV-7301",
  clientId,
  issuedOn: new Date("2026-08-01T00:00:00.000Z"),
  dueOn: new Date("2026-08-31T00:00:00.000Z"),
  lines: [
    {
      description: "Drafting plaint and verifying affidavit",
      quantityHundredths: 250,
      unitPriceCents: 20_000_00,
    },
    {
      description: "Court attendance",
      quantityHundredths: 500,
      unitPriceCents: 50_000_00,
    },
  ],
  payments: [],
};

const settlement = (shillings: number) => ({
  invoiceId,
  payment: {
    amountCents: shillings * 100,
    method: "Bank Transfer",
    receivedOn: new Date("2026-08-12T00:00:00.000Z"),
  } satisfies Billing.Payment,
  movement: {
    id: movementId(),
    clientId,
    reason: "Transfer to office account for costs",
    amount: Money.fromCents(shillings * 100),
    recordedAt: new Date("2026-08-12T00:00:00.000Z"),
    reference: invoice.number,
  } satisfies Ledger.TrustMovement,
});

const deposit = (shillings: number): Ledger.TrustMovement => ({
  id: movementId(),
  clientId,
  reason: "Deposit received",
  amount: Money.fromCents(shillings * 100),
  recordedAt: new Date("2026-08-02T00:00:00.000Z"),
});

const cleanUp = async () => {
  await raw(`DELETE FROM trust_movements WHERE client_id = $1`, [clientId]);
  await raw(`DELETE FROM invoices WHERE client_id = $1`, [clientId]);
  await raw(`DELETE FROM clients WHERE id = $1`, [clientId]);
  await raw(`DELETE FROM advocates WHERE id = $1`, [advocateId]);
};

beforeAll(async () => {
  if (!hasDatabase) return;
  await cleanUp();

  await raw(
    `INSERT INTO advocates (id, name, role, email, active)
     VALUES ($1, 'Billing Probe', 'Finance Officer', 'billing@example.co.ke', true)`,
    [advocateId],
  );
  await raw(
    `INSERT INTO clients (id, number, kind, name, email, phone, onboarded_on)
     VALUES ($1, 'CLT-7301', 'Individual', 'Billing Probe',
             'billing@example.co.ke', '+254722445109', '2026-01-10')`,
    [clientId],
  );
}, 60_000);

afterAll(async () => {
  if (!hasDatabase) return;
  await cleanUp();
  await runtime.dispose();
}, 60_000);

describeIfDb("InvoiceRepository against Postgres", () => {
  it("stores an invoice with its lines and reads it back unchanged", async () => {
    const exit = await run(
      Effect.gen(function* () {
        const repo = yield* InvoiceRepository;
        yield* repo.save(invoice);
        return yield* repo.byId(invoiceId);
      }),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toStrictEqual(invoice);
      expect(Billing.total(exit.value)).toBe(Money.fromCents(300_000_00));
    }
  });

  it("reports a missing invoice as NotFound", async () => {
    const missing = Schema.decodeSync(InvoiceId)(
      "eeeeeeee-0000-4000-8000-000000000099",
    );

    const exit = await run(
      Effect.flatMap(InvoiceRepository, (repo) => repo.byId(missing)),
    );

    const error = Exit.isFailure(exit)
      ? (exit.cause as { error?: { _tag?: string } }).error
      : undefined;
    expect(error?._tag).toBe("NotFound");
  });

  /**
   * The rollback test, and the reason `settleFromTrust` exists.
   *
   * The client holds nothing, so the trust withdrawal is refused by the Rule 10
   * trigger — after the payment row has already been inserted in the same
   * transaction. If the two writes were not atomic, the invoice would now show
   * a payment funded by nothing at all.
   */
  it("leaves no payment behind when the trust account cannot fund it", async () => {
    const exit = await run(
      Effect.flatMap(InvoiceRepository, (repo) =>
        repo.settleFromTrust(settlement(300_000)),
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    const error = Exit.isFailure(exit)
      ? (exit.cause as { error?: { _tag?: string } }).error
      : undefined;
    expect(error?._tag).toBe("TrustAccountUnderfunded");

    const payments = await raw<{ readonly n: string }>(
      `SELECT count(*) AS n FROM payments WHERE invoice_id = $1`,
      [invoiceId],
    );
    expect(Number(payments[0]?.n)).toBe(0);
  });

  it("reports the balance that was actually available", async () => {
    const exit = await run(
      Effect.gen(function* () {
        const trust = yield* TrustRepository;
        yield* trust.recordDeposit(deposit(120_000));

        const repo = yield* InvoiceRepository;
        return yield* repo.settleFromTrust(settlement(300_000));
      }),
    );

    const error = Exit.isFailure(exit)
      ? (exit.cause as { error?: { held?: number; reason?: string } }).error
      : undefined;

    expect(error?.held).toBe(Money.fromCents(120_000_00));
    expect(error?.reason).toContain("r. 10");
  });

  it("records both halves when the balance covers the fee", async () => {
    const exit = await run(
      Effect.gen(function* () {
        const repo = yield* InvoiceRepository;
        const trust = yield* TrustRepository;

        yield* repo.settleFromTrust(settlement(120_000));

        return {
          invoice: yield* repo.byId(invoiceId),
          balance: yield* trust.balanceFor(clientId),
        };
      }),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(Billing.paid(exit.value.invoice)).toBe(
        Money.fromCents(120_000_00),
      );
      expect(Billing.outstanding(exit.value.invoice)).toBe(
        Money.fromCents(180_000_00),
      );
      expect(exit.value.balance).toBe(Money.zero);
      expect(
        Billing.status(exit.value.invoice, new Date("2026-08-15T00:00:00Z")),
      ).toBe("Partially Paid");
    }
  });

  it("appends the next payment rather than replacing the first", async () => {
    const exit = await run(
      Effect.gen(function* () {
        const repo = yield* InvoiceRepository;
        const trust = yield* TrustRepository;

        yield* trust.recordDeposit(deposit(50_000));
        yield* repo.settleFromTrust(settlement(50_000));

        return yield* repo.byId(invoiceId);
      }),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.payments).toHaveLength(2);
      expect(Billing.paid(exit.value)).toBe(Money.fromCents(170_000_00));
    }

    const ordinals = await raw<{ readonly ordinal: number }>(
      `SELECT ordinal FROM payments WHERE invoice_id = $1 ORDER BY ordinal`,
      [invoiceId],
    );
    expect(ordinals.map((row) => row.ordinal)).toStrictEqual([0, 1]);
  });

  it("refuses to settle an invoice that does not exist, writing nothing", async () => {
    const missing = Schema.decodeSync(InvoiceId)(
      "eeeeeeee-0000-4000-8000-000000000098",
    );

    const exit = await run(
      Effect.gen(function* () {
        const trust = yield* TrustRepository;
        yield* trust.recordDeposit(deposit(10_000));

        const repo = yield* InvoiceRepository;
        return yield* repo.settleFromTrust({
          ...settlement(10_000),
          invoiceId: missing,
        });
      }),
    );

    const error = Exit.isFailure(exit)
      ? (exit.cause as { error?: { _tag?: string } }).error
      : undefined;
    expect(error?._tag).toBe("NotFound");

    // The deposit stands; the settlement wrote neither of its two rows.
    const exitBalance = await run(
      Effect.flatMap(TrustRepository, (trust) => trust.balanceFor(clientId)),
    );
    expect(Exit.isSuccess(exitBalance)).toBe(true);
    if (Exit.isSuccess(exitBalance)) {
      expect(exitBalance.value).toBe(Money.fromCents(10_000_00));
    }
  });

  it("finds the client's invoices", async () => {
    const exit = await run(
      Effect.flatMap(InvoiceRepository, (repo) => repo.forClient(clientId)),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.map((each) => each.number)).toStrictEqual(["INV-7301"]);
    }
  });

  it("leaves no client overdrawn", async () => {
    const exit = await run(
      Effect.flatMap(TrustRepository, (trust) => trust.overdrawn()),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value).toStrictEqual([]);
  });
});
