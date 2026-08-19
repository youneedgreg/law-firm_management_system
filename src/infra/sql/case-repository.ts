import { SqlClient, SqlSchema } from "@effect/sql";
import { Effect, Layer, Option, Schema } from "effect";
import type * as Matter from "../../domain/case/case";
import { CaseId, ClientId } from "../../domain/shared/ids";
import {
  CaseRepository,
  NotFound,
  type RepositoryFailure,
} from "../../services/repositories";
import { CaseFromRow } from "./case-model";
import { failure } from "./failure";

/**
 * Matters, in Postgres.
 *
 * Every read goes through `SqlSchema` with `CaseFromRow` as its result schema,
 * so a query hands back `Case` values and never a bag of columns. The practical
 * effect is that the flattened court, the cents column and the filing sentinel
 * stop existing at this boundary — a service consuming this repository has no
 * way to encounter them, because nothing that leaves this file carries them.
 *
 * `SELECT *` is deliberate. The row model is the list of columns that matter,
 * and a second copy of that list in every query is the copy that goes stale
 * when a column is added; `Schema.Struct` ignores the extras.
 */
export const CaseRepositoryLive = Layer.effect(
  CaseRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const findById = SqlSchema.findOne({
      Request: CaseId,
      Result: CaseFromRow,
      execute: (id) => sql`SELECT * FROM cases WHERE id = ${id}`,
    });

    const forClient = SqlSchema.findAll({
      Request: ClientId,
      Result: CaseFromRow,
      execute: (clientId) =>
        sql`SELECT * FROM cases WHERE client_id = ${clientId} ORDER BY opened_on DESC`,
    });

    /**
     * Everything not closed — the same predicate as the `cases_by_status`
     * partial index, so the index is actually used rather than merely present.
     */
    const openMatters = SqlSchema.findAll({
      Request: Schema.Void,
      Result: CaseFromRow,
      execute: () =>
        sql`SELECT * FROM cases WHERE status <> 'Closed' ORDER BY opened_on DESC`,
    });

    return CaseRepository.of({
      findById: (id) => findById(id).pipe(Effect.mapError(failure("findById"))),

      byId: (id) =>
        findById(id).pipe(
          Effect.mapError(failure("byId")),
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.fail(new NotFound({ entity: "Case", id })),
              onSome: Effect.succeed<Matter.Case>,
            }),
          ),
        ),

      forClient: (clientId) =>
        forClient(clientId).pipe(Effect.mapError(failure("forClient"))),

      openMatters: () =>
        openMatters().pipe(Effect.mapError(failure("openMatters"))),

      /**
       * Upsert, because `save` is the only write the interface offers and a
       * caller holding a `Case` should not have to know whether the row exists.
       *
       * The record handed to `sql.insert` is the *encoded* side of the very
       * schema the reads decode through, which is the property that makes this
       * safe: a column cannot be written in one shape and read in another,
       * because there is only one mapping and it runs in both directions.
       */
      save: (matter) =>
        Schema.encode(CaseFromRow)(matter).pipe(
          Effect.flatMap(
            (row) => sql`
              INSERT INTO cases ${sql.insert(row)}
              ON CONFLICT (id) DO UPDATE SET ${sql.update(row, ["id"])}
            `,
          ),
          Effect.as(matter),
          Effect.mapError(failure("save")),
        ) satisfies Effect.Effect<Matter.Case, RepositoryFailure>,
    });
  }),
);
