import { ConfigProvider, Effect, Exit, LogLevel, Redacted } from "effect";
import { describe, expect, it } from "vitest";
import { DatabaseConfig, ServiceIdentity, TelemetryConfig } from "./config";

/**
 * Configuration is the one place where a mistake is invisible until it is
 * expensive: a malformed URL fails at the first query in whichever request
 * happens to arrive first, and a weakened SSL mode does not fail at all.
 */

const load = (url: string) =>
  Effect.runPromiseExit(
    DatabaseConfig.pipe(
      Effect.provide(DatabaseConfig.Default),
      Effect.withConfigProvider(
        ConfigProvider.fromMap(new Map([["DATABASE_URL", url]])),
      ),
    ),
  );

const urlOf = async (input: string) => {
  const exit = await load(input);
  if (Exit.isFailure(exit)) throw new Error(`rejected: ${input}`);
  return Redacted.value(exit.value.url);
};

describe("DATABASE_URL", () => {
  it("is refused when it is not a Postgres URL", async () => {
    expect(Exit.isFailure(await load("mysql://user:pw@host/db"))).toBe(true);
    expect(Exit.isFailure(await load("host:5432/db"))).toBe(true);
  });

  it("accepts both accepted schemes", async () => {
    await expect(urlOf("postgres://u:p@h/db")).resolves.toContain(
      "postgres://",
    );
    await expect(urlOf("postgresql://u:p@h/db")).resolves.toContain(
      "postgresql://",
    );
  });

  /**
   * `pg` treats `sslmode=require` as `verify-full` today and warns that v9 will
   * adopt libpq semantics, where it stops verifying the host. Pinning the
   * stronger mode means that change arrives as a no-op rather than as a silent
   * downgrade on a dependency bump.
   */
  it("upgrades the sslmode Neon hands out", async () => {
    await expect(urlOf("postgresql://u:p@h/db?sslmode=require")).resolves.toBe(
      "postgresql://u:p@h/db?sslmode=verify-full",
    );
  });

  it("adds an sslmode when the URL carries none", async () => {
    await expect(urlOf("postgresql://u:p@h/db")).resolves.toBe(
      "postgresql://u:p@h/db?sslmode=verify-full",
    );
  });

  it("leaves the rest of the query string intact", async () => {
    await expect(
      urlOf("postgresql://u:p@h/db?sslmode=require&channel_binding=require"),
    ).resolves.toBe(
      "postgresql://u:p@h/db?sslmode=verify-full&channel_binding=require",
    );
  });

  it("appends to an existing query string rather than replacing it", async () => {
    await expect(
      urlOf("postgresql://u:p@h/db?application_name=oklaw"),
    ).resolves.toBe(
      "postgresql://u:p@h/db?application_name=oklaw&sslmode=verify-full",
    );
  });

  it("keeps the URL redacted, so a logged config cannot leak it", async () => {
    const exit = await load("postgresql://u:hunter2@h/db");

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(String(exit.value.url)).not.toContain("hunter2");
    }
  });

  it("defaults the pool to a size that suits a proxied database", async () => {
    const exit = await load("postgresql://u:p@h/db");

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value.maxConnections).toBe(5);
  });
});

const from = <A, E>(
  service: Effect.Effect<A, E, never>,
  environment: Record<string, string>,
) =>
  Effect.runPromiseExit(
    service.pipe(
      Effect.withConfigProvider(
        ConfigProvider.fromMap(new Map(Object.entries(environment))),
      ),
    ),
  );

const identityIn = (environment: Record<string, string>) =>
  from(
    ServiceIdentity.pipe(Effect.provide(ServiceIdentity.Default)),
    environment,
  );

const telemetryIn = (environment: Record<string, string>) =>
  from(
    TelemetryConfig.pipe(Effect.provide(TelemetryConfig.Default)),
    environment,
  );

/**
 * Both of these exist to make a log line and a span attributable to a build and
 * a deployment. Getting either wrong is invisible until somebody is reading an
 * incident and cannot say which commit produced it.
 */
describe("service identity", () => {
  it("names the build by its short commit", async () => {
    const exit = await identityIn({
      VERCEL_GIT_COMMIT_SHA: "9f2c1ab4e7d3115a0c8ee0aa3c1d9e2f4b6a8c70",
    });

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value.version).toBe("9f2c1ab");
  });

  it("says so plainly when there is no commit to name", async () => {
    const exit = await identityIn({});

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.version).toBe("dev");
      expect(exit.value.environment).toBe("development");
    }
  });

  /**
   * The distinction `NODE_ENV` cannot make. A preview deployment runs with
   * `NODE_ENV=production`, so a dashboard split on it would file every preview's
   * errors under production — which is how an incident gets declared over
   * somebody testing a branch.
   */
  it("separates preview from production", async () => {
    const preview = await identityIn({ VERCEL_ENV: "preview" });

    expect(Exit.isSuccess(preview)).toBe(true);
    if (Exit.isSuccess(preview))
      expect(preview.value.environment).toBe("preview");
  });

  it("refuses an environment it does not recognise", async () => {
    expect(Exit.isFailure(await identityIn({ VERCEL_ENV: "staging" }))).toBe(
      true,
    );
  });
});

describe("telemetry configuration", () => {
  /**
   * The default that matters. A log drain parses a JSON line into fields you
   * can filter on and treats a pretty-printed one as a string you cannot — so
   * the deployed default has to be `json`, and it has to be the default rather
   * than a variable somebody remembers to set.
   */
  it("logs JSON where a drain will read it and prose where a person will", async () => {
    const deployed = await telemetryIn({ VERCEL_ENV: "production" });
    const laptop = await telemetryIn({});

    expect(Exit.isSuccess(deployed)).toBe(true);
    if (Exit.isSuccess(deployed)) expect(deployed.value.format).toBe("json");

    expect(Exit.isSuccess(laptop)).toBe(true);
    if (Exit.isSuccess(laptop)) expect(laptop.value.format).toBe("pretty");
  });

  it("defaults to Info, and takes a level when it is given one", async () => {
    const byDefault = await telemetryIn({});
    const asked = await telemetryIn({ LOG_LEVEL: "Debug" });

    expect(Exit.isSuccess(byDefault)).toBe(true);
    if (Exit.isSuccess(byDefault)) {
      expect(byDefault.value.level).toBe(LogLevel.Info);
    }

    expect(Exit.isSuccess(asked)).toBe(true);
    if (Exit.isSuccess(asked)) expect(asked.value.level).toBe(LogLevel.Debug);
  });

  /**
   * A typo is refused rather than defaulted. `LOG_LEVEL=verbose` on a
   * deployment somebody has gone to the trouble of redeploying to debug should
   * fail loudly, not log at `Info` and leave them wondering.
   */
  it("refuses a level that is not one", async () => {
    expect(Exit.isFailure(await telemetryIn({ LOG_LEVEL: "verbose" }))).toBe(
      true,
    );
  });
});
