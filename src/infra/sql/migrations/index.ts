import { Migrator } from "@effect/sql";
import initialSchema, {
  statements as initialStatements,
} from "./0001_initial_schema";
import filingDatesAndContactOrder, {
  statements as filingStatements,
} from "./0002_filing_dates_and_contact_order";
import invoiceLineAndPaymentOrder, {
  statements as invoiceOrderStatements,
} from "./0003_invoice_line_and_payment_order";
import widenPhoneNumbers, {
  statements as phoneStatements,
} from "./0004_widen_phone_numbers";
import identityAndAudit, {
  statements as identityStatements,
} from "./0005_identity_and_audit";

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
  "0003_invoice_line_and_payment_order": invoiceLineAndPaymentOrder,
  "0004_widen_phone_numbers": widenPhoneNumbers,
  "0005_identity_and_audit": identityAndAudit,
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
  ...invoiceOrderStatements,
  ...phoneStatements,
  ...identityStatements,
];
