import type { SqlError } from "@effect/sql";

/**
 * Recognising the Rule 10 trigger's refusal.
 *
 * Rule 10 of the Advocates (Accounts) Rules is enforced by a database trigger,
 * because the rule needs the sum of a client's other movements and a `CHECK`
 * sees one row. The consequence is that a breach arrives as a `SqlError`
 * carrying a plpgsql message, which is the wrong shape for anyone to handle: a
 * service should be matching on `TrustAccountUnderfunded`, not string-matching
 * Postgres output, and certainly not learning that a trigger exists.
 *
 * Two repositories write to `trust_movements` — the ledger itself, and the
 * settlement that pays an invoice out of client money — so the recognition
 * lives here rather than being written twice and diverging the first time the
 * trigger's message is reworded.
 */
export const isRule10Violation = (error: SqlError.SqlError): boolean =>
  /r\.10|check_violation/i.test(String(error.cause ?? error.message));
