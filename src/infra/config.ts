import { Config, Effect, Redacted, Schema } from "effect";

/**
 * Environment configuration, validated once at startup.
 *
 * `process.env.DATABASE_URL!` scattered through the codebase fails at the first
 * query, in whichever request happens to arrive first, with a message about
 * `undefined` rather than about configuration. Reading it here means a missing
 * or malformed value fails immediately and says what is wrong.
 *
 * The URL is `Redacted`, so it cannot be logged by accident — connection
 * strings carry credentials, and the usual way they end up in a log aggregator
 * is somebody printing a config object while debugging.
 */

const PostgresUrl = Schema.String.pipe(
  Schema.filter(
    (value) =>
      value.startsWith("postgres://") || value.startsWith("postgresql://"),
    {
      message: () =>
        "DATABASE_URL must be a postgres:// or postgresql:// connection string",
    },
  ),
);

/**
 * Pins the SSL mode to `verify-full`.
 *
 * Neon hands out connection strings ending `?sslmode=require`. `pg` currently
 * treats `require` as `verify-full` — it validates the certificate chain and
 * the hostname — but warns that in v9 it will adopt libpq semantics, where
 * `require` means "encrypt, but do not check who you are talking to". That is a
 * downgrade that would arrive as a dependency bump rather than a decision, and
 * it would arrive silently.
 *
 * Rewriting it here rather than editing the environment variable: the value is
 * managed by Vercel and re-pulled by `vercel env pull`, so a hand-edit lasts
 * until the next sync, and would have to be repeated for preview and
 * production. One line in code covers every environment permanently.
 */
const pinSslVerification = (url: string): string =>
  /[?&]sslmode=/.test(url)
    ? url.replace(/([?&])sslmode=[^&]*/, "$1sslmode=verify-full")
    : `${url}${url.includes("?") ? "&" : "?"}sslmode=verify-full`;

export class DatabaseConfig extends Effect.Service<DatabaseConfig>()(
  "DatabaseConfig",
  {
    effect: Effect.gen(function* () {
      const configured = yield* Config.redacted("DATABASE_URL");

      // Validate the shape without unwrapping into anything that could be
      // logged: the value goes straight back into a Redacted afterwards.
      const validated = yield* Schema.decodeUnknown(PostgresUrl)(
        Redacted.value(configured),
      );

      return {
        url: Redacted.make(pinSslVerification(validated)),
        /** Neon pools at the proxy, so a small local pool is plenty. */
        maxConnections: yield* Config.integer("DATABASE_MAX_CONNECTIONS").pipe(
          Config.withDefault(5),
        ),
      };
    }),
  },
) {}
