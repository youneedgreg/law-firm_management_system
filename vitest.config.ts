import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

/**
 * Unit and component tests. Fast, hermetic, no external processes.
 *
 * Integration tests that need a real Postgres live in `*.integration.test.ts`
 * and run under `vitest.integration.config.ts` instead — they require Docker,
 * so keeping them out of the default run means `npm test` always works.
 */
export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "test/**/*.test.ts"],
    exclude: ["**/*.integration.test.ts", "**/node_modules/**"],
    globals: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      // Only code we have actually started testing. Raised as layers land —
      // a coverage target that includes unwritten code measures nothing.
      include: ["src/domain/**", "src/services/**", "src/lib/**"],
    },
  },
});
