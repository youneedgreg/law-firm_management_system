import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

/**
 * Unit and component tests. Fast, hermetic, no external processes.
 *
 * Integration tests that need a real Postgres live in `*.integration.test.ts`
 * and run under `vitest.integration.config.ts` instead — they require Docker,
 * so keeping them out of the default run means `npm test` always works.
 *
 * The environment stays Node. The handful of files that need a DOM say so at
 * the top — `// @vitest-environment jsdom` — because jsdom costs about half a
 * second per file to stand up, and three files out of twenty-three want one.
 * Declaring it per file also keeps the reason visible where it applies rather
 * than as a glob in this config that nobody reads.
 */
export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "test/**/*.test.ts"],
    exclude: ["**/*.integration.test.ts", "**/node_modules/**"],
    globals: false,
    /**
     * Fifteen seconds rather than the default five, and not because anything
     * here waits for anything.
     *
     * Standing up jsdom, React and a file's own module graph is a one-off cost
     * that Vitest charges to whichever test in the file runs first — around a
     * second on an idle machine. Two things multiply it: sixty-seven files
     * running in parallel across a handful of cores, and the v8 coverage
     * instrumentation that `npm run test:coverage` turns on, which is what CI
     * runs. Together they have taken the first test of a component file past
     * five seconds, and a test that fails when the computer is busy is a flake
     * however sound its logic.
     *
     * The alternative — a `vi.setConfig` in each heavy file — puts the same
     * explanation in five places and quietly omits it from the sixth. This
     * number is not a budget for slow tests: nothing in this suite sleeps, and
     * anything that genuinely hangs still fails, fifteen seconds later.
     */
    testTimeout: 15_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      /**
       * The floor the badge in the README claims, enforced.
       *
       * `docs/coverage.svg` is generated from the last measurement and is a
       * static file, so on its own it could go stale in the flattering
       * direction. These thresholds are what stop that: CI runs
       * `npm run test:coverage`, and coverage falling below the badge's number
       * fails the build rather than quietly making the badge a lie (ADR 0014).
       *
       * Set a little under the current figures rather than at them. A floor
       * pinned to the exact measurement fails on any refactor that deletes a
       * well-covered file, which trains people to lower it — and a threshold
       * somebody lowers on a red build is not a threshold.
       */
      thresholds: { lines: 90, statements: 90, branches: 90, functions: 78 },
      // Only code we have actually started testing. Raised as layers land —
      // a coverage target that includes unwritten code measures nothing.
      include: ["src/domain/**", "src/services/**", "src/lib/**", "src/rx/**"],
    },
  },
});
