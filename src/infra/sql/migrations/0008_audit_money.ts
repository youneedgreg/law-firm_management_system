import { SqlClient } from "@effect/sql";
import { Effect } from "effect";

/**
 * The money actions, added to the audit vocabulary.
 *
 * `audit_action` and `audited_entity` are Postgres enums, which is what makes
 * this migration necessary and also what makes it *worth* having them: the
 * database refuses an action nobody declared, so the trail cannot quietly grow
 * a category that no report knows to look for. The cost is a migration every
 * time the vocabulary grows, and that is the right trade for a table whose
 * whole value is that it can be reasoned about years later.
 *
 * ## How this was found, which is the interesting part
 *
 * Settling a fee note out of client money failed in the browser with "the
 * database refused the write" — and **the payment and the trust withdrawal were
 * not written either**. That is not a second bug; it is Phase 6's guarantee
 * doing its job. The audit entry goes in the same transaction as the mutation
 * it describes, precisely so that a change nobody is recorded as having made
 * cannot survive. The enum refused `invoice.settled`, the audit write failed,
 * and the transaction took the money with it.
 *
 * A system that wrote the audit entry afterwards would have moved KES 120,000
 * out of client account and logged nothing.
 *
 * ## Four actions, not one
 *
 * `invoice.settled` is separate from `invoice.paid` although both end in a
 * payment row, and the distinction is the one an auditor cares about: a payment
 * is the client sending money in, a settlement is the *firm* transferring money
 * it already held on trust into its own account. The second is a withdrawal
 * from client account under Rule 9 and the first is not. A trail that called
 * them the same thing could not answer "which withdrawals from client account
 * were made, and why", which is the question the Advocates (Accounts) Rules
 * exist to make answerable.
 *
 * `trust` joins `audited_entity` for the deposit, which acts on the client's
 * ledger rather than on any invoice.
 *
 * `ALTER TYPE … ADD VALUE` is transactional from Postgres 12 onward, with one
 * restriction that does not bite here: the new value cannot be *used* in the
 * same transaction that adds it. Nothing below inserts a row.
 */
export const statements: readonly string[] = [
  `
    ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'invoice.raised';
    ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'invoice.paid';
    ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'invoice.settled';
    ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'trust.deposited';

    ALTER TYPE audited_entity ADD VALUE IF NOT EXISTS 'trust';
  `,
];

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const statement of statements) {
    yield* sql.unsafe(statement);
  }
});
