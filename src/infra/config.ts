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

export class DatabaseConfig extends Effect.Service<DatabaseConfig>()(
  "DatabaseConfig",
  {
    effect: Effect.gen(function* () {
      const url = yield* Config.redacted("DATABASE_URL");

      // Validate the shape without unwrapping into anything that could be
      // logged: the value goes straight back into a Redacted afterwards.
      yield* Schema.decodeUnknown(PostgresUrl)(Redacted.value(url));

      return {
        url,
        /** Neon pools at the proxy, so a small local pool is plenty. */
        maxConnections: yield* Config.integer("DATABASE_MAX_CONNECTIONS").pipe(
          Config.withDefault(5),
        ),
      };
    }),
  },
) {}
