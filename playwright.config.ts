import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end, against a real browser and the real database.
 *
 * Everything below this line in the test pyramid already exists: the domain is
 * tested with no I/O, the services with in-memory repositories, the API through
 * the generated client with no socket, the components through React with a
 * stubbed `fetch`, and the repositories against real Postgres. What none of
 * them covers is the join — that a person can sign in, open a matter, record
 * their time, turn it into a fee note and take a payment, in a browser, with
 * every layer participating.
 *
 * ## Against Neon, and cleaning up after itself
 *
 * The alternative was a throwaway Postgres per run, which is hermetic and would
 * have been the safer choice. This runs against the same seeded Neon everything
 * else is verified against, because the thing worth proving is that the
 * deployed configuration works — the shared connection pool, the real
 * migrations, the seeded demo data a reader will actually see.
 *
 * The cost is that a run writes to the demonstration data, and it is paid in
 * `e2e/sweep.ts`: every record a run creates is marked, and the mark is swept
 * **before** the run as well as after it. Before, because an `afterEach` cannot
 * clean up after a process that crashed, and the debris from a crashed run is
 * exactly what the next one has to not trip over.
 *
 * ## One worker, deliberately
 *
 * This is a single-firm system (D-1). Two workers opening matters at once would
 * race on the derived matter reference — which the service handles, by retrying
 * onto the next free number, so the race would not *fail*; it would make the
 * reference a spec asserts on unpredictable. Parallelism here would buy a
 * minute and cost determinism, which the quality bar in §7 does not trade.
 */

const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  // Nothing here sleeps, so a generous per-test budget only ever pays out on a
  // cold Neon instance — which is a real thing to survive rather than a flake.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env["CI"]),
  retries: 0,
  reporter: process.env["CI"] ? "github" : "list",

  globalSetup: "./e2e/sweep.ts",
  globalTeardown: "./e2e/sweep.ts",

  use: {
    baseURL: `http://localhost:${String(PORT)}`,
    // On failure only: a passing run should leave nothing behind.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      // Signs in once and writes the cookie every other spec starts from.
      // Sign-in is still covered as a path of its own in `sign-in.spec.ts`,
      // which runs without the stored session.
      name: "setup",
      testMatch: /session\.setup\.ts/,
    },
    {
      name: "signed-out",
      testMatch: /sign-in\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "signed-in",
      testIgnore: /sign-in\.spec\.ts/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.session.json",
      },
    },
  ],

  /**
   * A production build, not `next dev`.
   *
   * The dev server recompiles on first hit, keeps a hot-reload socket open and
   * serves an error overlay that sits on top of the page — three sources of
   * timing noise in a suite whose whole value is being trustworthy about
   * timing. `npm run start` serves what Vercel serves.
   */
  webServer: {
    command: `npm run build && npx next start --port ${String(PORT)}`,
    url: `http://localhost:${String(PORT)}/sign-in`,
    reuseExistingServer: !process.env["CI"],
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    env: existsSync(".env.local") ? {} : {},
  },
});
