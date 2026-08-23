import { ConfigProvider, Effect, Exit, LogLevel, Redacted } from "effect";
import { describe, expect, it } from "vitest";
import {
  DatabaseConfig,
  DeploymentConfig,
  ServiceIdentity,
  TelemetryConfig,
} from "./config";

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

const deploymentIn = (environment: Record<string, string>) =>
  from(
    DeploymentConfig.pipe(Effect.provide(DeploymentConfig.Default)),
    environment,
  );

/**
 * The one configuration value whose *default* is the control rather than a
 * convenience (D-11).
 *
 * Everything the demonstration is allowed to do — a login that needs no
 * password, a cron that empties every table — is gated on `isDemo`. So the
 * question these tests ask is not "does it read the variable", which would be
 * testing Effect. It is "what does this system believe when nobody has told it
 * anything", because that is the state a freshly created Vercel project starts
 * in, and the answer has to be *not a demo*.
 */
describe("deployment kind", () => {
  /**
   * The test to break if you are about to make this required. A client
   * deployment sets no such variable, and it must run — with the affordances
   * off — rather than refuse to start.
   */
  it("is not a demo when nothing says it is", async () => {
    const exit = await deploymentIn({});

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value.isDemo).toBe(false);
  });

  it("is a demo only when it is asked to be", async () => {
    const exit = await deploymentIn({ DEMO_DEPLOYMENT: "true" });

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value.isDemo).toBe(true);
  });

  /**
   * `Config.boolean` takes the whole shell-truthy family, which is worth
   * pinning rather than assuming: somebody setting this in a dashboard is as
   * likely to type `yes` or `1` as `true`, and all three have to mean the same
   * thing on the deployment that wants to be a demo.
   */
  it("takes the spellings a person actually types", async () => {
    for (const value of ["true", "yes", "on", "1"]) {
      const exit = await deploymentIn({ DEMO_DEPLOYMENT: value });
      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) expect(exit.value.isDemo).toBe(true);
    }

    for (const value of ["false", "no", "off", "0"]) {
      const exit = await deploymentIn({ DEMO_DEPLOYMENT: value });
      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) expect(exit.value.isDemo).toBe(false);
    }
  });

  /**
   * It is case-sensitive, and this is the one that will bite somebody in a
   * dashboard: `DEMO_DEPLOYMENT=True` does not mean true, it means the
   * deployment refuses to start.
   *
   * Pinned deliberately rather than filed as a wart, because the direction is
   * the safe one. A capitalised value can only be typed on the deployment that
   * *wants* to be a demo — the client's is set by leaving it alone — so the
   * failure is loud, immediate, and lands on the portfolio site rather than
   * silently arming the switcher somewhere it should not be.
   */
  it("refuses a value it cannot read rather than guessing at one", async () => {
    for (const value of ["True", "YES", "maybe", ""]) {
      expect(
        Exit.isFailure(await deploymentIn({ DEMO_DEPLOYMENT: value })),
      ).toBe(true);
    }
  });

  /**
   * The likeliest mistake of all, and the one with no error attached: a
   * variable set on the right project under very slightly the wrong name. It
   * has to land on "not a demo", which is what makes the default rather than
   * the validation the thing protecting the client.
   */
  it("ignores a variable that is not the one it reads", async () => {
    const exit = await deploymentIn({ DEMO_DEPLOMENT: "true" });

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value.isDemo).toBe(false);
  });
});

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
