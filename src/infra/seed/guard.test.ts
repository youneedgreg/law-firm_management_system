import { Effect, Exit } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeploymentConfig } from "../config";
import { seed } from "./program";

/**
 * The seed refuses to load onto anything but the demonstration (D-11).
 *
 * This is the guard that covers the path neither the cron route nor
 * `resetDemoData` can: a person at a terminal running `npm run db:seed` with
 * the wrong `DATABASE_URL` exported. `wipe` empties twenty-three tables before
 * the program writes a single fixture, so there is no partial-success outcome
 * to recover from — by the time anybody notices, the firm's matters are gone
 * and what stands in their place is a fictional firm in Nairobi.
 *
 * ## What is asserted, and what deliberately is not
 *
 * That it fails *at the first step*, before any repository is resolved. The
 * check sits above `yield* AdvocateRepository`, which is what lets this test
 * provide `DeploymentConfig` and nothing else: if the guard were moved below
 * even one repository, the effect would fail for want of a service instead, the
 * error would be a different one, and this test would say so.
 *
 * That is the whole trick here. The test does not need a database to prove the
 * seed does not reach one — it proves it by refusing to supply anything a
 * database-touching step could possibly use.
 */

const withEnvironment = (value: string | undefined) => {
  if (value === undefined) delete process.env["DEMO_DEPLOYMENT"];
  else process.env["DEMO_DEPLOYMENT"] = value;
};

/**
 * `DeploymentConfig` alone — no `PgLive`, no repositories, no blob store.
 *
 * ## The cast is the assertion
 *
 * `seed` requires seventeen services. This narrows that to the one, which is a
 * lie about the type and a true statement about the execution: the guard runs
 * above `yield* AdvocateRepository`, so the fibre fails before any other tag is
 * looked up and the missing services are never missed.
 *
 * Written as a cast rather than by assembling the real `SeedLayer` because the
 * two failures are worth telling apart. If the guard were moved below even one
 * repository, this stops passing — the run dies looking for a service instead
 * of failing with the refusal, and the message assertion below says which
 * happened. A test that built the whole layer would sail through the same
 * mistake, connect to Postgres, and only then decide it was unhappy.
 */
const run = (): Promise<Exit.Exit<unknown, unknown>> =>
  Effect.runPromiseExit(
    (seed as unknown as Effect.Effect<unknown, unknown, DeploymentConfig>).pipe(
      Effect.provide(DeploymentConfig.Default),
    ),
  );

afterEach(() => {
  withEnvironment(undefined);
  vi.restoreAllMocks();
});

describe("the seed, off the demonstration", () => {
  it("refuses when nothing says this is a demo", async () => {
    withEnvironment(undefined);

    const exit = await run();

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("refuses when the deployment says it is not a demo", async () => {
    withEnvironment("false");

    const exit = await run();

    expect(Exit.isFailure(exit)).toBe(true);
  });

  /**
   * The message is the test, because of who reads it. Two very different people
   * hit this refusal — somebody setting the project up locally for the first
   * time, and somebody one keystroke from wiping a law firm — and the seed
   * cannot tell which. So it names the variable *and* says what the program
   * does, and this asserts both halves survive future editing.
   */
  it("names the variable, and says what it would have done", async () => {
    withEnvironment(undefined);

    const exit = await run();

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const message = String(exit.cause);
      expect(message).toContain("DEMO_DEPLOYMENT");
      expect(message).toMatch(/wipes every table/i);
    }
  });

  /**
   * A malformed flag is not permission either. `DEMO_DEPLOYMENT=True` fails to
   * decode, and a failure to decode has to stop the program rather than fall
   * through to the load.
   */
  it("refuses a flag it cannot read", async () => {
    withEnvironment("True");

    const exit = await run();

    expect(Exit.isFailure(exit)).toBe(true);
  });
});
