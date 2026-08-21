import { SqlClient, SqlSchema } from "@effect/sql";
import { Effect, Layer, Option, Schema } from "effect";
import type * as Hearing from "../../domain/court/hearing";
import { CaseId, HearingId } from "../../domain/shared/ids";
import {
  HearingRepository,
  NotFound,
  type RepositoryFailure,
} from "../../services/repositories";
import { failure } from "./failure";
import { HearingFromRow } from "./hearing-model";

/**
 * Court dates, in Postgres.
 *
 * `pending` is shaped to the `hearings_upcoming` partial index — over
 * `scheduled_for WHERE outcome IS NULL` — so the index is used rather than
 * merely present. Splitting it into "before today" and "after today" happens in
 * the service, against one clock reading, rather than as two queries against
 * two different `now()`s.
 */
export const HearingRepositoryLive = Layer.effect(
  HearingRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const findById = SqlSchema.findOne({
      Request: HearingId,
      Result: HearingFromRow,
      execute: (id) => sql`SELECT * FROM hearings WHERE id = ${id}`,
    });

    const forCase = SqlSchema.findAll({
      Request: CaseId,
      Result: HearingFromRow,
      execute: (caseId) =>
        sql`SELECT * FROM hearings WHERE case_id = ${caseId} ORDER BY scheduled_for`,
    });

    const pending = SqlSchema.findAll({
      Request: Schema.Void,
      Result: HearingFromRow,
      execute: () =>
        sql`SELECT * FROM hearings WHERE outcome IS NULL ORDER BY scheduled_for`,
    });

    const all = SqlSchema.findAll({
      Request: Schema.Void,
      Result: HearingFromRow,
      execute: () => sql`SELECT * FROM hearings ORDER BY scheduled_for DESC`,
    });

    return HearingRepository.of({
      byId: (id) =>
        findById(id).pipe(
          Effect.mapError(failure("byId")),
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(new NotFound({ entity: "Hearing", id })),
              onSome: Effect.succeed<Hearing.Hearing>,
            }),
          ),
        ),

      forCase: (caseId) =>
        forCase(caseId).pipe(Effect.mapError(failure("forCase"))),

      pending: () => pending().pipe(Effect.mapError(failure("pending"))),

      all: () => all().pipe(Effect.mapError(failure("all"))),

      save: (hearing) =>
        Schema.encode(HearingFromRow)(hearing).pipe(
          Effect.flatMap(
            (row) => sql`
              INSERT INTO hearings ${sql.insert(row)}
              ON CONFLICT (id) DO UPDATE SET ${sql.update(row, ["id"])}
            `,
          ),
          Effect.as(hearing),
          Effect.mapError(failure("save")),
        ) satisfies Effect.Effect<Hearing.Hearing, RepositoryFailure>,
    });
  }),
);
