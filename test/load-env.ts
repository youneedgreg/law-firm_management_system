import { existsSync } from "node:fs";

/**
 * Loads `.env.local` into `process.env` before the integration tests run.
 *
 * Vitest populates `import.meta.env` from dotenv files, not `process.env`, so
 * without this the database-backed tests see no `DATABASE_URL` and skip
 * themselves — silently, and while reporting green. A suite that quietly tests
 * nothing is worse than one that fails.
 *
 * A setup file rather than a global setup: Vitest runs tests in worker
 * processes, and only setup files run inside them.
 */
if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}
