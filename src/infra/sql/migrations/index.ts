import { Migrator } from "@effect/sql";
import initialSchema from "./0001_initial_schema";

/**
 * The migration set, listed explicitly.
 *
 * `fromRecord` over `fromGlob` on purpose: a glob resolves at build time and
 * behaves differently under Next, Vitest, and `tsx`, which is a poor property
 * for the thing that decides what shape the database is in. An explicit list
 * costs one import per migration and is the same everywhere.
 *
 * Migrations are append-only. Editing one that has run leaves every database
 * that already applied it silently different from the file.
 */
export const migrations = Migrator.fromRecord({
  "0001_initial_schema": initialSchema,
});
