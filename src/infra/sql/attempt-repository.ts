import { SqlClient } from "@effect/sql";
import { createHash } from "node:crypto";
import { Clock, Duration, Effect, Layer } from "effect";
import * as Throttle from "../../domain/identity/throttle";
import { AttemptLimiter } from "../../services/repositories";
import { writing } from "./resilience";

/**
 * Authentication attempt counters, in Postgres.
 *
 * ## The bucket is hashed here rather than in the domain
 *
 * `Throttle.forSignIn` produces readable names — `sign-in|203.0.113.7|
 * swanjiru@oklaw.co.ke` — because that is what makes the policy legible where
 * it is written. What gets stored is the SHA-256 of that string, and the
 * hashing happens in this file because it is a property of the *storage*, not
 * of the rule.
 *
 * The reason to hash at all: unhashed, this table is a list of who tried to
 * sign in, from which address, and when — sitting in the same database as the
 * matters those people are privileged to see, with none of the retention
 * discipline the audit table has. Hashed, it counts exactly as well and tells a
 * reader nothing. The audit trail still records refused sign-ins by address,
 * which is the place designed to hold that.
 *
 * A hash is not anonymisation and is not claimed to be: the input space is
 * small enough to enumerate if somebody has both the table and a list of
 * addresses. What it removes is the *casual* read — a dump, a backup, a support
 * query — which is how this kind of data actually leaks.
 *
 * ## Why the counter is spent before it is checked
 *
 * `INSERT … ON CONFLICT DO UPDATE … RETURNING` is one statement, so the number
 * it hands back is the count including this attempt and every concurrent one
 * that got there first. The natural-reading alternative — read the count,
 * compare, then increment — lets a burst of simultaneous attempts all read the
 * same number below the limit and all proceed, which is precisely the shape of
 * traffic a rate limit is for.
 */

const hashed = (bucket: string): string =>
  createHash("sha256").update(bucket).digest("hex");

const WINDOW_MS = Duration.toMillis(Throttle.WINDOW);

/**
 * The attempt's own window, as a timestamp.
 *
 * Floored to the window so that every attempt in the same fifteen minutes
 * shares a primary key, which is what makes the count a single upsert rather
 * than an aggregate over rows.
 *
 * Computed from the `Clock` rather than from Postgres's `now()`, so the whole
 * thing is a value this process can reason about — and so a test can move the
 * window without moving the database's clock.
 */
const windowStart = Effect.map(
  Clock.currentTimeMillis,
  (now) => new Date(Math.floor(now / WINDOW_MS) * WINDOW_MS),
);

export const AttemptLimiterLive = Layer.effect(
  AttemptLimiter,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    /**
     * Deletes everything older than a window.
     *
     * On every attempt, rather than on a schedule, because there is no
     * scheduler in this application and a table that grows without bound under
     * exactly the traffic it exists to survive is a poor thing to leave to
     * Phase 10. It is one indexed `DELETE` against a table with a handful of
     * live rows, on a path that is already talking to Postgres about passwords.
     */
    const sweep = (cutoff: Date) =>
      sql`DELETE FROM auth_attempts WHERE window_start < ${cutoff}`.pipe(
        writing("AttemptLimiter.sweep"),
      );

    return AttemptLimiter.of({
      spend: (buckets) =>
        Effect.gen(function* () {
          const start = yield* windowStart;

          const rows = buckets.map((bucket) => ({
            bucket: hashed(bucket),
            windowStart: start,
            attempts: 1,
          }));

          yield* sweep(new Date(start.getTime() - WINDOW_MS));

          const spent = yield* sql<{
            readonly bucket: string;
            readonly attempts: number;
          }>`
            INSERT INTO auth_attempts ${sql.insert(rows)}
            ON CONFLICT (bucket, window_start)
              DO UPDATE SET attempts = auth_attempts.attempts + 1
            RETURNING bucket, attempts
          `.pipe(
            /**
             * `writing`, not `reading`, despite the `RETURNING`. The statement
             * increments a counter, so replaying it on a connection that
             * dropped mid-flight would charge an attempt twice — and the
             * person it locks out would be whoever was typing their password
             * when the network hiccuped.
             */
            writing("AttemptLimiter.spend"),
          );

          const counts = new Map(
            spent.map((row) => [row.bucket, Number(row.attempts)]),
          );

          /**
           * Keyed back by the *caller's* names rather than by the hashes, so
           * nothing above this file has to know that the storage hashes
           * anything.
           */
          return new Map(
            buckets.map((bucket) => [bucket, counts.get(hashed(bucket)) ?? 0]),
          );
        }),

      forget: (buckets) =>
        sql`
          DELETE FROM auth_attempts
           WHERE bucket IN ${sql.in(buckets.map(hashed))}
        `.pipe(writing("AttemptLimiter.forget"), Effect.asVoid),
    });
  }),
);
