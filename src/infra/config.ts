import { Config, Effect, LogLevel, Redacted, Schema } from "effect";

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

/**
 * Whether this deployment is the public demonstration (D-11).
 *
 * This repository runs in two places: the portfolio demo, where strangers are
 * invited to press destructive buttons in fixtures for a firm that does not
 * exist, and a law firm's installation, where the same buttons would be a
 * breach. The difference between them is one variable, read here.
 *
 * ## The default is the control
 *
 * `false`, and that is the whole design. An unset variable, a misspelt one, one
 * somebody deleted while tidying the Vercel dashboard, and a project created
 * tomorrow by someone who has never read this file all have to mean the same
 * thing: **a real deployment, with the demonstration affordances off.** Absence
 * must never mean "demo", because the two mistakes are not comparable — a demo
 * that quietly becomes real is a dull afternoon, and a real deployment that
 * quietly becomes a demo publishes a one-click Managing Partner login and
 * empties the client account at midnight.
 *
 * So it is `withDefault` rather than required, and the temptation to "tidy" it
 * into a required value should be resisted: that would make a client deployment
 * fail to start until somebody set a variable whose entire purpose is to be
 * unset there.
 *
 * ## What it is not
 *
 * It is not a security boundary by itself, and nothing should treat it as one.
 * Every control it takes part in requires it **in addition to** that control's
 * own check, never instead of it — see `CronConfig` below, where the reasoning
 * that argument had to survive is written out.
 */
export class DeploymentConfig extends Effect.Service<DeploymentConfig>()(
  "DeploymentConfig",
  {
    effect: Effect.gen(function* () {
      return {
        isDemo: yield* Config.boolean("DEMO_DEPLOYMENT").pipe(
          Config.withDefault(false),
        ),
      };
    }),
  },
) {}

/**
 * The secret the nightly demo reset is called with (D-5, D-11).
 *
 * Vercel sets `Authorization: Bearer $CRON_SECRET` on every cron invocation
 * when the variable is present, and sets nothing at all when it is not — so
 * "unset" must mean the endpoint refuses, never that it runs unauthenticated.
 * Reading it as a required value is what makes that structural: with no
 * variable there is no `CronConfig`, so there is nothing for the route to
 * compare against and it answers 503.
 *
 * ## Why there is now a flag, having argued there should not be
 *
 * This comment used to end: *there is no flag, for the reason Phase 8 gave for
 * having none on tracing — a flag is a second way for a control to be silently
 * absent.* That reasoning was right and still is. `DEMO_DEPLOYMENT` does not
 * contradict it, because of how the two are combined.
 *
 * A flag that can be checked **instead of** the secret is a second way to be
 * absent: two doors, and an attacker needs whichever is unlocked. A flag that
 * is required **alongside** it is a second way to *refuse*: two locks on one
 * door, and absence closes it rather than opening it. `DEMO_DEPLOYMENT` is the
 * second kind, and it must stay that way — the day somebody rewrites the reset
 * to run when *either* holds, this paragraph is what they have broken.
 *
 * The second lock exists because the first one's failure mode is total.
 * `vercel.json` is committed, so a second Vercel project built from this
 * repository registers the same nightly cron, and one environment variable
 * being set by mistake is then the whole distance between a firm's trust
 * ledger and a `DELETE` across every table the seed owns.
 *
 * Redacted, and length-checked. A four-character secret is a public button for
 * doing that.
 */
export class CronConfig extends Effect.Service<CronConfig>()("CronConfig", {
  effect: Effect.gen(function* () {
    return {
      secret: yield* Config.redacted("CRON_SECRET").pipe(
        Config.validate({
          message:
            "CRON_SECRET must be at least 16 characters. " +
            "Generate one with: openssl rand -base64 24",
          validation: (value) => Redacted.value(value).length >= 16,
        }),
      ),
    };
  }),
}) {}

/**
 * What this process calls itself when it writes a log line or opens a span.
 *
 * Three facts, and the third is the one that earns the service its own tag: a
 * trace or an error report is only useful if you can say **which build** it
 * came from. `VERCEL_GIT_COMMIT_SHA` is the deployment's commit, set by the
 * platform on every build, so a span from a preview and a span from production
 * are distinguishable without anybody having to remember what was deployed on
 * Tuesday.
 *
 * Short-form SHA rather than the full forty characters, because it is read by
 * people — it is the string you paste after `git show`.
 *
 * `environment` is `VERCEL_ENV` (`production`, `preview`, `development`) rather
 * than `NODE_ENV`, which is `production` on a preview deployment too. Telling
 * the two apart is the entire point of the attribute: a spike in errors on
 * preview is somebody testing, and the same spike in production is an incident.
 */
export class ServiceIdentity extends Effect.Service<ServiceIdentity>()(
  "ServiceIdentity",
  {
    effect: Effect.gen(function* () {
      const commit = yield* Config.string("VERCEL_GIT_COMMIT_SHA").pipe(
        Config.map((sha) => sha.slice(0, 7)),
        Config.withDefault("dev"),
      );

      return {
        name: "oklaw",
        version: commit,
        environment: yield* Config.literal(
          "production",
          "preview",
          "development",
        )("VERCEL_ENV").pipe(Config.withDefault("development" as const)),
      };
    }),
  },
) {}

/**
 * How much is logged, and in what shape.
 *
 * Two settings, both with defaults that are right for where they run, so
 * neither has to be set anywhere for the application to behave sensibly.
 *
 * `LOG_FORMAT` defaults to `json` on a deployment and `pretty` on a laptop.
 * That is not a cosmetic choice: Vercel's log drains parse a JSON line into
 * queryable fields and treat a pretty-printed one as an opaque string, so
 * `annotations.caseId` is either something you can filter on or something you
 * can only eyeball. Locally the tradeoff runs the other way — nobody greps
 * their own terminal.
 *
 * `LOG_LEVEL` defaults to `Info`. `Debug` is deliberately not the default even
 * in development: the SQL layer logs every statement at `Debug`, and a page
 * that issues forty queries would bury the one line that matters.
 */
export class TelemetryConfig extends Effect.Service<TelemetryConfig>()(
  "TelemetryConfig",
  {
    effect: Effect.gen(function* () {
      const deployed = yield* Config.string("VERCEL_ENV").pipe(
        Config.option,
        Config.map((value) => value._tag === "Some"),
      );

      return {
        level: yield* Config.logLevel("LOG_LEVEL").pipe(
          Config.withDefault(LogLevel.Info),
        ),
        format: yield* Config.literal(
          "json",
          "pretty",
        )("LOG_FORMAT").pipe(
          Config.withDefault(
            deployed ? ("json" as const) : ("pretty" as const),
          ),
        ),
      };
    }),
  },
) {}
