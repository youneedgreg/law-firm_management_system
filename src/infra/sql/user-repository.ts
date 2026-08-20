import { SqlClient } from "@effect/sql";
import { Effect, Layer, Option, ParseResult, Schema } from "effect";
import * as Identity from "../../domain/identity/principal";
import { NotFound, UserRepository } from "../../services/repositories";
import { failure } from "./failure";

/**
 * Logins, in Postgres.
 *
 * One query answers "who is this", and it is one query on purpose: it runs on
 * every authenticated request in the application, so a second round trip would
 * be paid for by every page. The `LEFT JOIN`s let a single row carry either
 * shape — a staff member's role from `advocates`, or a client's id — and
 * `users_exactly_one_subject` in migration 0005 guarantees that exactly one of
 * the two sides is populated.
 */

/** A row from the join below, before the union is decided. */
const UserRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  advocateId: Schema.NullOr(Schema.String),
  clientId: Schema.NullOr(Schema.String),
  role: Schema.NullOr(Schema.String),
});

/**
 * Which variant of `Principal` a row is.
 *
 * A `transformOrFail`, like every other row↔domain mapping here, so that a row
 * satisfying neither branch is a loud refusal rather than a half-populated
 * principal. That case is supposed to be unreachable — the `CHECK` constraint
 * forbids it — which is precisely why it fails rather than defaulting: if it
 * ever does happen, the constraint is gone, and a login of indeterminate kind
 * is the last thing that should be waved through.
 *
 * The type side is `Schema.typeSchema`, as elsewhere, so the ids come back
 * branded instead of as bare strings.
 */
export const PrincipalFromRow = Schema.transformOrFail(
  UserRow,
  Schema.typeSchema(Identity.Principal),
  {
    strict: true,

    decode: (row, _options, ast) => {
      if (row.advocateId !== null && row.role !== null) {
        return ParseResult.decodeUnknown(Identity.Staff)({
          _tag: "Staff",
          userId: row.id,
          advocateId: row.advocateId,
          name: row.name,
          email: row.email,
          role: row.role,
        });
      }

      if (row.clientId !== null) {
        return ParseResult.decodeUnknown(Identity.PortalUser)({
          _tag: "PortalUser",
          userId: row.id,
          clientId: row.clientId,
          name: row.name,
          email: row.email,
        });
      }

      return ParseResult.fail(
        new ParseResult.Type(
          ast,
          row,
          `login ${row.email} is linked to neither a staff record nor a ` +
            `client, which users_exactly_one_subject should have refused`,
        ),
      );
    },

    /**
     * One-way, and deliberately so.
     *
     * Every other mapping in this directory encodes as well as decodes, because
     * the same shape is read and written. A principal is not written: it is
     * derived from three tables, and `provision` below writes the one of them
     * this repository owns. An encode side here would be a way to write a
     * `users` row that silently ignored the client link, which is the mistake
     * the union exists to prevent.
     */
    encode: (principal, _options, ast) =>
      ParseResult.fail(
        new ParseResult.Type(
          ast,
          principal,
          "a Principal is read from three tables and cannot be written back " +
            "as one row; use UserRepository.provision",
        ),
      ),
  },
);

export const UserRepositoryLive = Layer.effect(
  UserRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const decode = Schema.decodeUnknown(PrincipalFromRow);

    /**
     * `disabled_at IS NULL` is in the join, not checked afterwards.
     *
     * A disabled login must not resolve to a principal at all, and the safest
     * place for that is the same query that answers who they are — a check
     * further out is one somebody can call around. Its sessions are deleted
     * when the account is disabled; this is the second lock on the same door,
     * for the session that was created in the same second.
     */
    const lookup = (where: "id" | "email", value: string) =>
      sql<Record<string, unknown>>`
        SELECT u.id,
               u.name,
               u.email,
               u.advocate_id,
               u.client_id,
               a.role
          FROM users u
          LEFT JOIN advocates a ON a.id = u.advocate_id
          LEFT JOIN clients   c ON c.id = u.client_id
         WHERE ${where === "id" ? sql`u.id = ${value}` : sql`lower(u.email) = lower(${value})`}
           AND u.disabled_at IS NULL
      `.pipe(
        Effect.flatMap((rows) =>
          rows[0] === undefined
            ? Effect.succeedNone
            : Effect.map(decode(rows[0]), Option.some),
        ),
        Effect.mapError(failure(`principal by ${where}`)),
      );

    return UserRepository.of({
      principalOf: (id) =>
        lookup("id", id).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.fail(new NotFound({ entity: "User", id })),
              onSome: Effect.succeed<Identity.Principal>,
            }),
          ),
        ),

      byEmail: (email) => lookup("email", email),

      /**
       * Issues a login for somebody the firm already knows about.
       *
       * An upsert on the email address rather than an insert, so that re-running
       * the seed updates the existing login instead of failing on the unique
       * index — the same idempotence every other repository here offers, and
       * the reason a nightly demo reset (D-5) does not need to drop the table.
       *
       * The subject is written from the tagged input, so a row with both links
       * or neither cannot be produced from this path even before Postgres
       * refuses it.
       */
      provision: (login) =>
        sql`
          INSERT INTO users ${sql.insert({
            id: login.id,
            name: login.name,
            email: login.email,
            advocateId:
              login.subject._tag === "Staff" ? login.subject.advocateId : null,
            clientId:
              login.subject._tag === "Client" ? login.subject.clientId : null,
          })}
          ON CONFLICT (email) DO UPDATE SET
            name        = EXCLUDED.name,
            advocate_id = EXCLUDED.advocate_id,
            client_id   = EXCLUDED.client_id,
            updated_at  = now()
        `.pipe(
          Effect.mapError(failure("provision")),
          Effect.zipRight(lookup("email", login.email)),
          Effect.flatMap(
            Option.match({
              /**
               * A defect, not a failure. The row was written one statement
               * ago; if it is not there, something is wrong that no caller can
               * do anything sensible about, and the interface promises this
               * returns the principal it just created.
               */
              onNone: () =>
                Effect.die(
                  new Error(
                    `login ${login.email} was written and could not be read back`,
                  ),
                ),
              onSome: Effect.succeed<Identity.Principal>,
            }),
          ),
        ),
    });
  }),
);
