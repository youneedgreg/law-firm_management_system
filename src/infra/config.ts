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

/**
 * The secret every session cookie is signed with, and the origin they are
 * issued for.
 *
 * Validated for length rather than merely for presence. Better Auth accepts any
 * string and warns on a weak one at startup — a warning in a log nobody reads
 * is not a control, and a 12-character secret is a forgeable session cookie,
 * which is every account at once. 32 characters is the width of the hash it
 * feeds, so anything shorter is a shortened key however it was generated.
 *
 * `baseURL` matters for a reason that is easy to miss: it is what the cookie's
 * origin checks are made against. Left unset, Better Auth derives it from the
 * incoming request, which means the application believes whatever `Host` header
 * it is sent. On Vercel the deployment URL is known from the environment, so
 * there is no reason to take the request's word for it.
 */
export class AuthConfig extends Effect.Service<AuthConfig>()("AuthConfig", {
  effect: Effect.gen(function* () {
    const secret = yield* Config.redacted("BETTER_AUTH_SECRET").pipe(
      Config.validate({
        message:
          "BETTER_AUTH_SECRET must be at least 32 characters. " +
          "Generate one with: openssl rand -base64 32",
        validation: (value) => Redacted.value(value).length >= 32,
      }),
    );

    /**
     * Preview deployments each get their own hostname, which is why this falls
     * back to `VERCEL_URL` — the deployment's own URL — rather than to the
     * production one. A preview signing cookies for the production origin
     * would issue cookies the browser refuses to send back, and the symptom is
     * a login that appears to succeed and then does nothing.
     */
    const deploymentUrl = yield* Config.string("VERCEL_URL").pipe(
      Config.map((host) => `https://${host}`),
      Config.withDefault("http://localhost:3000"),
    );

    return {
      secret,
      baseUrl: yield* Config.string("BETTER_AUTH_URL").pipe(
        Config.withDefault(deploymentUrl),
      ),
    };
  }),
}) {}
