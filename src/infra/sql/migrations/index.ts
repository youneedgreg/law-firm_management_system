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
import mpesaReconciliation, {
  statements as mpesaStatements,
} from "./0006_mpesa_reconciliation";
import validateMpesaConfirmations, {
  statements as validateMpesaStatements,
} from "./0007_validate_mpesa_confirmations";
import auditMoney, {
  statements as auditMoneyStatements,
} from "./0008_audit_money";
import auditTime, {
  statements as auditTimeStatements,
} from "./0009_audit_time";
import caseParties, {
  statements as casePartiesStatements,
} from "./0010_case_parties";
import auditClients, {
  statements as auditClientsStatements,
} from "./0011_audit_clients";
import auditHearings, {
  statements as auditHearingsStatements,
} from "./0012_audit_hearings";
import auditDocuments, {
  statements as auditDocumentsStatements,
} from "./0013_audit_documents";
import tasks, { statements as tasksStatements } from "./0014_tasks";
import messages, { statements as messagesStatements } from "./0015_messages";
import firmRecords, {
  statements as firmRecordsStatements,
} from "./0016_firm_records";
import appointments, {
  statements as appointmentsStatements,
} from "./0017_appointments";

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
  "0006_mpesa_reconciliation": mpesaReconciliation,
  "0007_validate_mpesa_confirmations": validateMpesaConfirmations,
  "0008_audit_money": auditMoney,
  "0009_audit_time": auditTime,
  "0010_case_parties": caseParties,
  "0011_audit_clients": auditClients,
  "0012_audit_hearings": auditHearings,
  "0013_audit_documents": auditDocuments,
  "0014_tasks": tasks,
  "0015_messages": messages,
  "0016_firm_records": firmRecords,
  "0017_appointments": appointments,
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
  ...mpesaStatements,
  ...validateMpesaStatements,
  ...auditMoneyStatements,
  ...auditTimeStatements,
  ...casePartiesStatements,
  ...auditClientsStatements,
  ...auditHearingsStatements,
  ...auditDocumentsStatements,
  ...tasksStatements,
  ...messagesStatements,
  ...firmRecordsStatements,
  ...appointmentsStatements,
];
