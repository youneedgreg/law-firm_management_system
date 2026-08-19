import { SqlClient, SqlSchema } from "@effect/sql";
import { Effect, Layer, Option, Schema } from "effect";
import type * as Firm from "../../domain/firm/advocate";
import { AdvocateId } from "../../domain/shared/ids";
import {
  AdvocateRepository,
  NotFound,
  type RepositoryFailure,
} from "../../services/repositories";
import { AdvocateFromRow } from "./advocate-model";
import { failure } from "./failure";

/** People at the firm, in Postgres. The simplest of the repositories: one row,
 *  one entity, no aggregate to reassemble. */
export const AdvocateRepositoryLive = Layer.effect(
  AdvocateRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const findById = SqlSchema.findOne({
      Request: AdvocateId,
      Result: AdvocateFromRow,
      execute: (id) => sql`SELECT * FROM advocates WHERE id = ${id}`,
    });

    const all = SqlSchema.findAll({
      Request: Schema.Void,
      Result: AdvocateFromRow,
      execute: () => sql`SELECT * FROM advocates ORDER BY name`,
    });

    return AdvocateRepository.of({
      byId: (id) =>
        findById(id).pipe(
          Effect.mapError(failure("byId")),
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(new NotFound({ entity: "Advocate", id })),
              onSome: Effect.succeed<Firm.Advocate>,
            }),
          ),
        ),

      all: () => all().pipe(Effect.mapError(failure("all"))),

      save: (advocate) =>
        Schema.encode(AdvocateFromRow)(advocate).pipe(
          Effect.flatMap(
            (row) => sql`
              INSERT INTO advocates ${sql.insert(row)}
              ON CONFLICT (id) DO UPDATE SET ${sql.update(row, ["id"])}
            `,
          ),
          Effect.as(advocate),
          Effect.mapError(failure("save")),
        ) satisfies Effect.Effect<Firm.Advocate, RepositoryFailure>,
    });
  }),
);
