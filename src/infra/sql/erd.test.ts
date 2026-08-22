import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { type Catalog, GROUPS, readCatalog, renderPage } from "./erd";
import { allStatements } from "./migrations";

/**
 * The committed diagram, checked against the schema it claims to describe.
 *
 * A generated file nobody regenerates is a hand-drawn file with extra steps —
 * which is the entire failure mode of every stale ERD in every repository. So
 * the page is rebuilt here from the same migrations and compared byte for byte
 * with what is on disk. A migration that adds a table and does not run
 * `npm run docs:erd` fails this, in CI, before the diagram has had a chance to
 * become a lie.
 *
 * It shares its Postgres with nothing: PGlite is created here as it is in
 * `schema.test.ts`, costing about a second, and the whole file runs in the
 * default suite with no Docker and no connection string.
 *
 * **Writing this found two defects in the grouping**, which is the argument for
 * the second test below. `case_parties` was listed as a table and is not one —
 * migration 0010 adds `opposing_parties` as an array column on `cases`, and the
 * group was written from the migration's *name*. And Better Auth's
 * `verifications` table was in the schema and in nobody's group, so it appeared
 * in the diagram and in none of the prose.
 */

let catalog: Catalog;

beforeAll(async () => {
  const db = await PGlite.create();

  for (const statement of allStatements) {
    await db.exec(statement);
  }

  catalog = await readCatalog(
    async <Row>(sql: string) => (await db.query<Row>(sql)).rows,
  );

  await db.close();
}, 60_000);

describe("docs/erd.md", () => {
  it("is what the migrations produce", async () => {
    const committed = await readFile(
      new URL("../../../docs/erd.md", import.meta.url),
      "utf8",
    );

    expect(committed).toBe(renderPage(catalog));
  });

  /**
   * The grouping is the one hand-written thing on the page, so it is the one
   * thing that can drift. Both directions: a table in no group is invisible in
   * the prose, and a group naming a table that does not exist is a claim about
   * a schema that never existed.
   */
  it("accounts for every table exactly once", () => {
    const grouped = GROUPS.flatMap((group) => group.tables);
    const stored = catalog.tables.map((table) => table.name);

    expect([...grouped].sort()).toStrictEqual([...stored].sort());
  });
});

describe("the diagram itself", () => {
  /**
   * The cardinality is the only thing on the diagram that is an *argument*
   * rather than a fact restated: `cases.court_kind` is nullable because a
   * matter at the Tax Appeals Tribunal has no court in the Article 162
   * hierarchy to point at, and `hearings.case_id` is not, because a hearing
   * with no matter is not a hearing.
   */
  it("distinguishes a required parent from an optional one", () => {
    const page = renderPage(catalog);

    expect(page).toContain("cases ||--|{ hearings : case_id");
    expect(page).toContain("cases ||--o{ invoices : case_id");
  });

  it("marks the keys", () => {
    const page = renderPage(catalog);

    expect(page).toContain("uuid id PK");
    expect(page).toContain("uuid case_id FK");
  });
});
