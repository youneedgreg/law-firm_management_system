import { Effect, Exit, Layer, Schema } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClientId, TrustMovementId } from "../../domain/shared/ids";
import * as Money from "../../domain/shared/money";
import * as Ledger from "../../domain/trust/ledger";
import { TrustRepository } from "../../services/repositories";
import { PgLive } from "./client";
import { TrustRepositoryLive } from "./trust-repository";

/**
 * The trust repository against a real Postgres.
 *
 * Runs only when `DATABASE_URL` is set, so `npm test` on a fresh checkout is
 * unaffected. Point it at a Neon branch, not production — it writes and then
 * deletes rows.
 *
 * What this covers that the PGlite schema tests cannot: the actual driver, the
 * `@effect/sql` layer on top of it, and — the reason this file exists — that a
 * trigger refusal is translated back into `TrustAccountUnderfunded` rather than
 * escaping as a raw SQL error.
 */

const hasDatabase = Boolean(process.env["DATABASE_URL"]);
const describeIfDb = hasDatabase ? describe : describe.skip;

const layer = TrustRepositoryLive.pipe(Layer.provideMerge(PgLive));

const clientId = Schema.decodeSync(ClientId)(
  "99999999-9999-4999-8999-999999999999",
);
const advocateId = "88888888-8888-4888-8888-888888888888";

let sequence = 0;
const movementId = () => {
  sequence += 1;
  return Schema.decodeSync(TrustMovementId)(
    `77777777-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
  );
};

const movement = (
  reason: Ledger.MovementReason,
  shillings: number,
): Ledger.TrustMovement => ({
  id: movementId(),
  clientId,
  reason,
  amount: Money.fromCents(shillings * 100),
  recordedAt: new Date(),
});

const run = <A, E>(
  effect: Effect.Effect<A, E, TrustRepository>,
): Promise<Exit.Exit<A, E>> =>
  Effect.runPromiseExit(
    effect.pipe(Effect.provide(layer)) as Effect.Effect<A, E>,
  );

const raw = (sql: string, params: readonly unknown[] = []) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* (yield* Effect.promise(
        async () => import("@effect/sql"),
      )).SqlClient.SqlClient;
      return yield* client.unsafe(sql, params as never);
    }).pipe(Effect.provide(PgLive)) as Effect.Effect<unknown>,
  );

beforeAll(async () => {
  if (!hasDatabase) return;

  await raw(
    `INSERT INTO advocates (id, name, role, email, active)
     VALUES ($1, 'Integration Probe', 'Advocate', 'probe@example.co.ke', true)
     ON CONFLICT (id) DO NOTHING`,
    [advocateId],
  );
  await raw(
    `INSERT INTO clients (id, number, kind, name, email, phone, onboarded_on)
     VALUES ($1, 'CLT-8888', 'Individual', 'Integration Probe',
             'probe@example.co.ke', '+254722445109', '2026-01-10')
     ON CONFLICT (id) DO NOTHING`,
    [clientId],
  );
  await raw(`DELETE FROM trust_movements WHERE client_id = $1`, [clientId]);
}, 60_000);

afterAll(async () => {
  if (!hasDatabase) return;
  await raw(`DELETE FROM trust_movements WHERE client_id = $1`, [clientId]);
  await raw(`DELETE FROM clients WHERE id = $1`, [clientId]);
  await raw(`DELETE FROM advocates WHERE id = $1`, [advocateId]);
}, 60_000);

describeIfDb("TrustRepository against Postgres", () => {
  it("starts a client at a zero balance", async () => {
    const exit = await run(
      Effect.flatMap(TrustRepository, (repo) => repo.balanceFor(clientId)),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value).toBe(0);
  });

  it("records a deposit and reflects it in the balance", async () => {
    const exit = await run(
      Effect.gen(function* () {
        const repo = yield* TrustRepository;
        yield* repo.recordDeposit(movement("Deposit received", 200_000));
        return yield* repo.balanceFor(clientId);
      }),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toBe(Money.fromCents(200_000_00));
    }
  });

  it("allows a withdrawal within the balance", async () => {
    const exit = await run(
      Effect.gen(function* () {
        const repo = yield* TrustRepository;
        yield* repo.recordWithdrawal(movement("Payment to client", 50_000));
        return yield* repo.balanceFor(clientId);
      }),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toBe(Money.fromCents(150_000_00));
    }
  });

  /**
   * The reason this file exists. The database refuses via a trigger; the caller
   * should see a domain error with the real balance in it, not a plpgsql
   * message it would have to parse.
   */
  it("translates the trigger's refusal into TrustAccountUnderfunded", async () => {
    const exit = await run(
      Effect.flatMap(TrustRepository, (repo) =>
        repo.recordWithdrawal(movement("Payment to client", 400_000)),
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);

    const error = Exit.isFailure(exit)
      ? (exit.cause as { error?: unknown }).error
      : undefined;

    expect((error as Ledger.TrustAccountUnderfunded)?._tag).toBe(
      "TrustAccountUnderfunded",
    );
    expect((error as Ledger.TrustAccountUnderfunded)?.held).toBe(
      Money.fromCents(150_000_00),
    );
    expect((error as Ledger.TrustAccountUnderfunded)?.reason).toContain(
      "r. 10",
    );
  });

  it("leaves the balance untouched after a refusal", async () => {
    const exit = await run(
      Effect.flatMap(TrustRepository, (repo) => repo.balanceFor(clientId)),
    );

    if (Exit.isSuccess(exit)) {
      expect(exit.value).toBe(Money.fromCents(150_000_00));
    }
  });

  it("reports no client overdrawn", async () => {
    const exit = await run(
      Effect.flatMap(TrustRepository, (repo) => repo.overdrawn()),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value).toStrictEqual([]);
  });

  it("reads movements back in the order they were recorded", async () => {
    const exit = await run(
      Effect.flatMap(TrustRepository, (repo) => repo.movementsFor(clientId)),
    );

    if (Exit.isSuccess(exit)) {
      expect(exit.value.map((m) => m.reason)).toStrictEqual([
        "Deposit received",
        "Payment to client",
      ]);
      expect(exit.value[0]?.amount).toBe(Money.fromCents(200_000_00));
    }
  });
});
