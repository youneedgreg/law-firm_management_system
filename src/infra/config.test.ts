import { ConfigProvider, Effect, Exit, Redacted } from "effect";
import { describe, expect, it } from "vitest";
import { DatabaseConfig } from "./config";

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
