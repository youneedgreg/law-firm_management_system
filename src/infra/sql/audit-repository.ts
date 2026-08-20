import { SqlClient } from "@effect/sql";
import { Effect, Layer, Option, ParseResult, Schema } from "effect";
import * as Audit from "../../domain/audit/entry";
import { AuditRepository } from "../../services/repositories";
import { failure } from "./failure";

/**
 * The audit trail, in Postgres.
 *
 * Insert and select, and nothing else — there is no `update` to implement
 * because the interface has none and because the `audit_log_no_update` trigger
 * would refuse it anyway. The two agree deliberately: the interface says what
 * this system does, and the trigger says what the database permits, and a
 * safeguard that exists in only one of those places is one refactor from being
 * gone.
 */

/**
 * A row ↔ an entry.
 *
 * The columns are flat where the domain nests: an entry carries an `Actor`, and
 * the table carries `actor_user_id`, `actor_name` and `actor_role`. Flattening
 * here rather than storing the actor as jsonb keeps "everything this person
 * did" a plain indexed query instead of a jsonb path lookup, and that is the
 * query the compliance screen exists to run.
 */
export const EntryFromRow = Schema.transformOrFail(
  Schema.Struct({
    id: Schema.String,
    at: Schema.ValidDateFromSelf,
    actorUserId: Schema.NullOr(Schema.String),
    actorName: Schema.String,
    actorRole: Schema.String,
    action: Schema.String,
    entity: Schema.String,
    entityId: Schema.NullOr(Schema.String),
    /**
     * `jsonb` arrives already parsed by the driver, so this is an object and
     * not a string. Typed as `Unknown` and validated by `Snapshot` on the way
     * through: what is in the column is whatever was stored, possibly by a
     * version of this application that no longer exists.
     */
    before: Schema.NullOr(Schema.Unknown),
    after: Schema.NullOr(Schema.Unknown),
  }),
  Schema.typeSchema(Audit.AuditEntry),
  {
    strict: true,

    /**
     * Decoded against the **type** side, not the schema.
     *
     * `AuditEntry` holds three `Schema.Option` fields, and an `Option` on the
     * encoded side is `{ "_tag": "Some", "value": … }` — a JSON shape, which is
     * not what a row holds and not what this builds. `typeSchema` strips the
     * transformations and asks only "is this a valid `AuditEntry`", which is
     * exactly the question here: the row has already been turned into domain
     * values, `Option` included.
     *
     * Missing it produced a decode failure on *reads only* — writes were fine,
     * because they go the other way — so it surfaced as a compliance screen
     * that 500ed while every test passed. See `audit-model.test.ts`, which is
     * the round trip that now covers it.
     */
    decode: (row) =>
      ParseResult.decodeUnknown(Schema.typeSchema(Audit.AuditEntry))({
        id: row.id,
        at: row.at,
        actor: {
          userId: Option.fromNullable(row.actorUserId),
          name: row.actorName,
          role: row.actorRole,
        },
        action: row.action,
        entity: row.entity,
        entityId: Option.fromNullable(row.entityId),
        before: Option.fromNullable(row.before as Audit.Snapshot | null),
        after: Option.fromNullable(row.after as Audit.Snapshot | null),
      }),

    encode: (entry) =>
      ParseResult.succeed({
        id: entry.id,
        at: entry.at,
        actorUserId: Option.getOrNull(entry.actor.userId),
        actorName: entry.actor.name,
        actorRole: entry.actor.role,
        action: entry.action,
        entity: entry.entity,
        entityId: Option.getOrNull(entry.entityId),
        before: Option.getOrNull(entry.before) as unknown,
        after: Option.getOrNull(entry.after) as unknown,
      }),
  },
);

export const AuditRepositoryLive = Layer.effect(
  AuditRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const decode = Schema.decodeUnknown(EntryFromRow);
    const encode = Schema.encode(EntryFromRow);

    const read = (rows: readonly Record<string, unknown>[]) =>
      Effect.forEach(rows, (row) => decode(row));

    return AuditRepository.of({
      /**
       * No `ON CONFLICT`. Every other write in this codebase is an upsert, and
       * this one must not be: an entry is a fact about a moment, and two facts
       * are two rows. A duplicate id here would be a generator collision, and
       * the right response to that is a loud failure, not a silent overwrite of
       * the entry it collided with.
       */
      record: (entry) =>
        encode(entry).pipe(
          Effect.flatMap(
            (row) =>
              sql`INSERT INTO audit_log ${sql.insert({
                ...row,
                // The jsonb columns are handed over as JSON text: `sql.insert`
                // would otherwise send an object the driver renders as a
                // Postgres composite literal.
                before: row.before === null ? null : JSON.stringify(row.before),
                after: row.after === null ? null : JSON.stringify(row.after),
              })}`,
          ),
          Effect.as(entry),
          Effect.mapError(failure("record")),
        ),

      recent: (limit) =>
        sql<Record<string, unknown>>`
          SELECT * FROM audit_log ORDER BY at DESC, id LIMIT ${limit}
        `.pipe(Effect.flatMap(read), Effect.mapError(failure("recent"))),

      forEntity: (entity, id) =>
        sql<Record<string, unknown>>`
          SELECT * FROM audit_log
           WHERE entity = ${entity} AND entity_id = ${id}
           ORDER BY at DESC, id
        `.pipe(Effect.flatMap(read), Effect.mapError(failure("forEntity"))),
    });
  }),
);
