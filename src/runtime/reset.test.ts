import { Either } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetDemoData } from "./reset";

/**
 * The refusal that stands between a firm's records and a nightly wipe (D-11).
 *
 * `resetDemoData` empties twenty-three tables and loads fixtures for a firm
 * that does not exist. `vercel.json` is committed, so a second Vercel project
 * built from this repository registers the same cron — which means the question
 * "is this the demonstration?" is asked on an installation holding real matters,
 * real client money and real correspondence, and the answer has to be no
 * without anybody having remembered to make it so.
 *
 * ## What these tests actually prove
 *
 * That it refuses *before it does anything*. A test asserting only that the
 * call returned a failure would pass just as happily if the wipe ran and then
 * something else went wrong, which is the one outcome that matters and the one
 * such a test could not tell apart. So `seed` is mocked, and the assertion is
 * that it was never called: not "the reset failed", but "the reset did not
 * happen".
 *
 * ## Why the seed is mocked rather than pointed at a database
 *
 * The point of failure is reached before any connection is opened, and proving
 * that requires a test that would *notice* one being opened. A real Postgres
 * here would make the pass ambiguous — it would be satisfied by a reset that
 * connected, thought better of it, and disconnected. The integration suite runs
 * the genuine seed against genuine Postgres; this one is about what does not
 * run.
 */

const seed = vi.hoisted(() => vi.fn());

vi.mock("../infra/seed/program", () => ({
  seed,
  SeedLayer: { _tag: "SeedLayerStub" },
}));

/**
 * `resetDemoData` reads the flag through `isDemoDeployment`, which reads the
 * environment. Set per test and torn down, rather than through a
 * `ConfigProvider` — the value this system has to get right is the one that
 * arrives from a Vercel dashboard as a string, and a provider built in the test
 * would be testing a substitute for exactly the mechanism under examination.
 */
const withEnvironment = (value: string | undefined) => {
  if (value === undefined) delete process.env["DEMO_DEPLOYMENT"];
  else process.env["DEMO_DEPLOYMENT"] = value;
};

/**
 * Imported once, at the top, rather than re-imported per test.
 *
 * The flag is read on every call — `isDemoDeployment` builds its config layer
 * each time and `ConfigProvider` reads `process.env` when asked, not when the
 * module loads — so there is no cached decision for a module reset to clear.
 * Resetting anyway is not merely wasteful here: this module pulls in the
 * application runtime, and re-importing it for each case took the file past
 * Vitest's timeout once the whole suite was running beside it.
 */
const reset = () => resetDemoData();

afterEach(() => {
  withEnvironment(undefined);
  vi.clearAllMocks();
});

describe("the nightly reset, off the demonstration", () => {
  /**
   * The test to break if somebody removes the guard. An unset variable is what
   * a freshly created Vercel project has, and it is the state a firm's
   * installation stays in permanently.
   */
  it("refuses, and does not reach the seed, when nothing says this is a demo", async () => {
    withEnvironment(undefined);

    const outcome = await reset();

    expect(Either.isLeft(outcome)).toBe(true);
    expect(seed).not.toHaveBeenCalled();
  });

  /**
   * `DEMO_DEPLOYMENT=false` is the same answer as no variable at all, and worth
   * its own case: somebody tidying a dashboard is as likely to set the value
   * explicitly as to remove it, and both have to mean the tables stay where
   * they are.
   */
  it("refuses when the deployment says it is not a demo", async () => {
    withEnvironment("false");

    const outcome = await reset();

    expect(Either.isLeft(outcome)).toBe(true);
    expect(seed).not.toHaveBeenCalled();
  });

  /**
   * A value the flag cannot read must not be read as permission. This is the
   * `DEMO_DEPLOYMENT=True` case — capitalised, and therefore not a boolean —
   * and the reset's answer to it is to not run.
   */
  it("does not reach the seed when the flag cannot be read at all", async () => {
    withEnvironment("True");

    await expect(reset()).rejects.toThrow();
    expect(seed).not.toHaveBeenCalled();
  });

  /**
   * The refusal says what was refused and why, because the audience is whoever
   * is reading a 500 from a cron they did not know was registered.
   */
  it("says what it refused, rather than failing blankly", async () => {
    withEnvironment(undefined);

    const outcome = await reset();

    expect(Either.isLeft(outcome)).toBe(true);
    if (Either.isLeft(outcome)) {
      expect(outcome.left.message).toMatch(/not the demonstration/i);
    }
  });
});
