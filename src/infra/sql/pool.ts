import { Context, Effect, Layer, Redacted } from "effect";
import Pg from "pg";
import { DatabaseConfig } from "../config";

/**
 * The connection pool, as a service — because two things now need it.
 *
 * Until Phase 6 the pool was an implementation detail of `PgClient.layer`, and
 * nothing outside `@effect/sql` ever saw it. Better Auth changes that: it owns
 * the sessions table and talks to Postgres through Kysely, so it needs a
 * connection of its own. Handing it a connection *string* would be the obvious
 * move and would quietly double the pool — the same failure Phase 4 avoided by
 * sharing the API's `memoMap`, arriving the same way, at exactly the traffic
 * where Neon's connection limit starts to matter.
 *
 * So the pool is constructed once, here, and both consumers are given the same
 * object: `PgClient.layerFromPool` for everything the application does, and
 * `betterAuth({ database: pool })` for everything sessions do. One pool, two
 * clients, one place that decides how large it is.
 *
 * `acquireRelease` is what makes the lifecycle honest — the pool is ended when
 * the layer's scope closes, which is what a test's `dispose()` is doing when it
 * finishes without leaving a handle open.
 */
export class PgPool extends Context.Tag("oklaw/PgPool")<PgPool, Pg.Pool>() {}

export const PgPoolLive = Layer.scoped(
  PgPool,
  Effect.gen(function* () {
    const config = yield* DatabaseConfig;

    return yield* Effect.acquireRelease(
      Effect.sync(() => {
        const pool = new Pg.Pool({
          connectionString: Redacted.value(config.url),
          max: config.maxConnections,
          application_name: "oklaw",
        });

        /**
         * Required, not defensive. `pg` emits `error` on the pool when an
         * *idle* client's connection drops — which Neon does routinely, since
         * it closes idle connections — and an `error` event with no listener is
         * an unhandled exception that takes the process down. The pool
         * discards the dead client and carries on by itself; the listener
         * exists so that Node does not turn the notification into a crash.
         * `@effect/sql-pg` attaches the same empty handler for the same reason.
         */
        pool.on("error", () => {});

        return pool;
      }),
      (pool) =>
        Effect.promise(() => pool.end()).pipe(
          // A pool that will not close is not a reason to fail a shutdown: the
          // process is going away and taking the sockets with it.
          Effect.catchAllDefect(() => Effect.void),
        ),
    );
  }),
).pipe(Layer.provide(DatabaseConfig.Default));
