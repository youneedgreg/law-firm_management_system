import { SqlClient } from "@effect/sql";
import { Effect } from "effect";

/**
 * Counters for authentication attempts, and the audit action for refusing one.
 *
 * ## Why this is a table
 *
 * The obvious implementation of a rate limit is a `Map` in module scope, and on
 * a serverless platform it is not a rate limit. Several instances serve the
 * traffic, each with its own heap, and any of them may be discarded between two
 * requests — so an in-process counter permits some multiple of the intended
 * attempts and forgets everything on a deploy. A control whose strictness
 * depends on how many functions happen to be warm is not one you can describe
 * to anybody.
 *
 * Postgres is already here, already shared, and already the thing that would
 * have to be up for a sign-in to succeed anyway.
 *
 * ## The bucket is a hash
 *
 * `bucket` is `sha256(kind|source|address)`, computed in the repository. It
 * could as easily be the plain string, and then this table would be a log of
 * who tried to sign in, from which address, and when — sitting beside the
 * matters those people are privileged to see, with none of the retention rules
 * an audit table gets. The hash keeps the counter working and makes the table
 * uninteresting to read, which is the correct trade for a column nothing ever
 * needs to display.
 *
 * The audit trail still records refused sign-ins by address, deliberately, in
 * the one place designed to hold that.
 *
 * ## A fixed window, not a sliding one
 *
 * `window_start` is the attempt's time floored to the window, so the key is
 * `(bucket, window)` and a count is a single upsert. The known weakness of a
 * fixed window is a double burst across the boundary — the last second of one
 * window and the first of the next. At these thresholds that is ten attempts
 * instead of five, which changes nothing about whether a password list gets
 * anywhere, and the alternative is a sorted set of timestamps per bucket and a
 * scan on every attempt.
 *
 * ## `session.throttled`
 *
 * A new `AuditAction` is a migration — the rule Phase 7 established when the
 * enum refused `invoice.settled`, and the drift guard in `schema.test.ts`
 * compares the domain's union against this enum in both directions. A refusal
 * for trying too often is a genuinely different event from a refusal for a
 * wrong password: one is somebody who forgot, the other is somebody or
 * something that has now been stopped, and an incident review that cannot tell
 * them apart cannot tell whether the control fired.
 */

export const statements: readonly string[] = [
  `
    CREATE TABLE auth_attempts (
      -- sha256 of the bucket name. Never displayed, never joined to.
      bucket       text NOT NULL,
      window_start timestamptz NOT NULL,
      attempts     integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),

      PRIMARY KEY (bucket, window_start)
    );

    -- The sweep runs on every attempt and deletes everything older than a
    -- window. Without this index it is a sequential scan on a table whose whole
    -- purpose is to be written to quickly under attack.
    CREATE INDEX auth_attempts_expiry ON auth_attempts (window_start);
  `,
  `ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'session.throttled';`,
];

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const statement of statements) {
    yield* sql.unsafe(statement);
  }
});
