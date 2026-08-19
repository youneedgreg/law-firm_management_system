import { Migrator } from "@effect/sql";
import initialSchema, {
  statements as initialStatements,
} from "./0001_initial_schema";
import filingDatesAndContactOrder, {
  statements as filingStatements,
} from "./0002_filing_dates_and_contact_order";

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
  "0002_filing_dates_and_contact_order": filingDatesAndContactOrder,
});

/**
 * The same DDL as a flat list, in order, for the PGlite schema tests.
 *
 * They apply exactly what a real database applies rather than building their
 * own tables: a test whose schema is written by the test proves only that the
 * test agrees with itself.
 */
export const allStatements: readonly string[] = [
  ...initialStatements,
  ...filingStatements,
];
