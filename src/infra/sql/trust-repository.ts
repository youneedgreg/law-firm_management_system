import { SqlClient } from "@effect/sql";
import { Effect, Layer } from "effect";
import type { ClientId } from "../../domain/shared/ids";
import * as Money from "../../domain/shared/money";
import * as Ledger from "../../domain/trust/ledger";
import { TrustRepository } from "../../services/repositories";
import { failure } from "./failure";
import { guarded, reading, writing } from "./resilience";
import { isRule10Violation } from "./rule10";

/**
 * The trust ledger, in Postgres.
 *
 * The one interesting problem here is the Rule 10 refusal. The rule is enforced
 * by a database trigger, so a breach surfaces as a `SqlError` carrying a
 * plpgsql message — which is the wrong shape for a caller to handle. A service
 * should be matching on `TrustAccountUnderfunded`, not string-matching a
 * Postgres error, and certainly not learning that a trigger exists.
 *
 * So this file translates. `recordWithdrawal` recognises the trigger's specific
 * refusal and reconstructs the domain error from the balance it reads back,
 * leaving everything else as a `RepositoryFailure`.
 */

export const TrustRepositoryLive = Layer.effect(
  TrustRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const balanceFor = (clientId: ClientId) =>
      sql<{ balanceCents: string | null }>`
        SELECT balance_cents FROM client_trust_balances
         WHERE client_id = ${clientId}
      `.pipe(
        Effect.map((rows) =>
          Money.fromCents(Number(rows[0]?.balanceCents ?? 0)),
        ),
        reading("TrustRepository.balanceFor"),
      );

    const insert = (movement: Ledger.TrustMovement) => sql`
      INSERT INTO trust_movements (id, client_id, reason, amount_cents, recorded_at, reference)
      VALUES (
        ${movement.id},
        ${movement.clientId},
        ${movement.reason},
        ${movement.amount},
        ${movement.recordedAt},
        ${movement.reference ?? null}
      )
    `;

    return TrustRepository.of({
      balanceFor,

      movementsFor: (clientId) =>
        sql<{
          id: string;
          clientId: string;
          reason: Ledger.MovementReason;
          amountCents: string;
          recordedAt: Date;
          reference: string | null;
        }>`
          SELECT id, client_id, reason, amount_cents, recorded_at, reference
            FROM trust_movements
           WHERE client_id = ${clientId}
           ORDER BY recorded_at
        `.pipe(
          Effect.map((rows) =>
            rows.map((row): Ledger.TrustMovement => ({
              id: row.id as Ledger.TrustMovement["id"],
              clientId: row.clientId as ClientId,
              reason: row.reason,
              amount: Number(row.amountCents),
              recordedAt: row.recordedAt,
              ...(row.reference === null ? {} : { reference: row.reference }),
            })),
          ),
          reading("TrustRepository.movementsFor"),
        ),

      recordDeposit: (movement) =>
        insert(movement).pipe(
          Effect.as(movement),
          writing("TrustRepository.recordDeposit"),
        ),

      /**
       * Records a withdrawal, translating the trigger's refusal.
       *
       * The balance is read *after* the failure rather than before it. Reading
       * first and deciding here would reintroduce the race the trigger's
       * `FOR UPDATE` exists to close: two concurrent withdrawals could both
       * see a sufficient balance and both proceed. Letting Postgres decide and
       * then asking what the balance was keeps the database as the arbiter.
       */
      recordWithdrawal: (movement) =>
        insert(movement).pipe(
          Effect.as(movement),
          guarded("TrustRepository.recordWithdrawal", { replayable: false }),
          Effect.catchAll((error) =>
            isRule10Violation(error)
              ? balanceFor(movement.clientId).pipe(
                  Effect.flatMap((held) =>
                    Effect.fail(
                      new Ledger.TrustAccountUnderfunded({
                        clientId: movement.clientId,
                        held,
                        requested: movement.amount,
                      }),
                    ),
                  ),
                )
              : Effect.fail(failure("TrustRepository.recordWithdrawal")(error)),
          ),
        ),

      overdrawn: () =>
        sql<{ clientId: string }>`
          SELECT client_id FROM client_trust_balances WHERE balance_cents < 0
        `.pipe(
          Effect.map((rows) => rows.map((row) => row.clientId as ClientId)),
          reading("TrustRepository.overdrawn"),
        ),
    });
  }),
);
