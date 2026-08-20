import { PGlite } from "@electric-sql/pglite";
import { getSchema } from "better-auth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { allStatements } from "../sql/migrations";
import { AUTH_OPTIONS } from "./options";

/**
 * Migration 0005 against Better Auth's own idea of its schema.
 *
 * The library ships a CLI that generates these tables. Using it was rejected —
 * it would put four tables outside the migration sequence, applied by a
 * different tool, and `users` is not only Better Auth's table anyway (it is
 * where a login is tied to a member of staff or a client). The cost of writing
 * them by hand is that they can be *wrong*, and wrong in a way nothing catches
 * until a query fails at run time against a column that does not exist.
 *
 * So the expectation is asked for rather than assumed. `getSchema` returns the
 * tables and columns the library will query, computed from the same options
 * object the running instance is built with, and this compares that list
 * against what the migration actually creates in a real Postgres.
 *
 * **What this catches that a human review does not:** a field added by a future
 * version of Better Auth. `account.issuer` arrived in 1.7 and is required; a
 * codebase that had hand-written the earlier schema would have upgraded
 * cleanly, deployed, and then failed on the first sign-in. Here that is a
 * failing test with the column named in it.
 */

let db: PGlite;

const columnsOf = async (table: string): Promise<readonly string[]> => {
  const result = await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY column_name`,
    [table],
  );

  return result.rows.map((row) => row.column_name);
};

beforeAll(async () => {
  db = await PGlite.create();

  for (const statement of allStatements) {
    await db.exec(statement);
  }
}, 60_000);

afterAll(async () => {
  await db?.close();
});

/**
 * The schema the *configured* instance expects.
 *
 * Built from `AUTH_OPTIONS`, so the field maps in `options.ts` are part of what
 * is being checked: renaming a column in the migration without renaming it in
 * the map fails here, and so does the reverse.
 */
const expected = getSchema(AUTH_OPTIONS);

describe("the tables Better Auth expects", () => {
  it("names the four tables the migration creates", () => {
    expect(Object.keys(expected).sort()).toEqual([
      "accounts",
      "sessions",
      "users",
      "verifications",
    ]);
  });

  it.each(["users", "sessions", "accounts", "verifications"])(
    "creates every column %s needs",
    async (table) => {
      const required = Object.values(expected[table]?.fields ?? {}).map(
        (field) => field.fieldName ?? "",
      );

      const actual = new Set(await columnsOf(table));

      // `id` is implicit in Better Auth's model and explicit in the DDL.
      expect(actual.has("id")).toBe(true);

      for (const column of required) {
        expect(
          actual.has(column),
          `${table}.${column} is missing from migration 0005`,
        ).toBe(true);
      }
    },
  );

  /**
   * Required fields are `NOT NULL`, and this is the half that a "does the
   * column exist" check misses.
   *
   * A nullable `token` on `sessions` would accept every write the library makes
   * and quietly allow a session row with no token — which is a row that can
   * never be matched by a cookie, and a person who is mysteriously signed out.
   */
  it.each(["users", "sessions", "accounts", "verifications"])(
    "marks %s's required columns NOT NULL",
    async (table) => {
      const nullable = await db.query<{
        column_name: string;
        is_nullable: string;
      }>(
        `SELECT column_name, is_nullable FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1`,
        [table],
      );

      const nullableColumns = new Set(
        nullable.rows
          .filter((row) => row.is_nullable === "YES")
          .map((row) => row.column_name),
      );

      for (const field of Object.values(expected[table]?.fields ?? {})) {
        if (field.required !== true) continue;

        expect(
          nullableColumns.has(field.fieldName ?? ""),
          `${table}.${field.fieldName} is required by Better Auth but nullable`,
        ).toBe(false);
      }
    },
  );

  /**
   * The columns the library never writes are ours, and are listed here so that
   * a reader can tell the two apart.
   */
  it("carries the columns this application added to users", async () => {
    const columns = new Set(await columnsOf("users"));

    expect(columns.has("advocate_id")).toBe(true);
    expect(columns.has("client_id")).toBe(true);
    expect(columns.has("disabled_at")).toBe(true);
  });

  /** Nothing is quoted-camelCase; the whole schema reads as one schema. */
  it("uses snake_case throughout, as the other eleven tables do", async () => {
    for (const table of ["users", "sessions", "accounts", "verifications"]) {
      for (const column of await columnsOf(table)) {
        expect(column, `${table}.${column} is not snake_case`).toBe(
          column.toLowerCase(),
        );
      }
    }
  });
});
