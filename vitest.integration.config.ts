import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

/**
 * Integration tests against a real Postgres, started per-run by Testcontainers.
 *
 * Requires a running Docker daemon. Kept in a separate config so a missing
 * Docker install never breaks `npm test` — see ADR 0006.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ["src/**/*.integration.test.ts"],
    // `DATABASE_URL` lives in `.env.local`, which Vitest does not put on
    // `process.env` by itself.
    setupFiles: ["./test/load-env.ts"],
    // Pulling and booting a Postgres image is slow on a cold cache.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Containers are shared per file; parallel files would multiply them.
    fileParallelism: false,
  },
});
