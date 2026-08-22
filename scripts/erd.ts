import { writeFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { readCatalog, renderPage } from "../src/infra/sql/erd";
import { allStatements } from "../src/infra/sql/migrations";

/**
 * Writes `docs/erd.md`. Run with `npm run docs:erd`.
 *
 * The migrations are applied to a throwaway Postgres first, so the diagram
 * describes the schema they produce rather than the schema anybody remembers
 * writing. PGlite is Postgres compiled to WebAssembly: no Docker, no
 * connection string, and — the property that matters for a docs script —
 * **nothing that could accidentally be pointed at the real database**. A
 * generator that read the live catalogue would describe whatever happened to be
 * deployed, including a migration somebody applied by hand and never committed.
 *
 * The equivalent check lives in `src/infra/sql/erd.test.ts`, which regenerates
 * the page and compares. A generated file nobody regenerates is a hand-drawn
 * file with extra steps.
 */

/**
 * Wrapped rather than written at the top level: this package is CommonJS, so
 * `tsx` compiles the file with esbuild's `cjs` output, where a top-level
 * `await` is a build error rather than a runtime one.
 */
const main = async (): Promise<void> => {
  const db = await PGlite.create();

  for (const statement of allStatements) {
    await db.exec(statement);
  }

  const catalog = await readCatalog(
    async <Row>(sql: string) => (await db.query<Row>(sql)).rows,
  );

  await writeFile(
    new URL("../docs/erd.md", import.meta.url),
    renderPage(catalog),
    "utf8",
  );

  await db.close();

  process.stdout.write(
    `docs/erd.md — ${String(catalog.tables.length)} tables, ` +
      `${String(catalog.references.length)} foreign keys\n`,
  );
};

void main();
