import { SqlClient } from "@effect/sql";
import { Effect } from "effect";

/**
 * M-Pesa reconciliation, in the database.
 *
 * Two statements doing two different jobs.
 *
 * The **unique index** is the one that cannot live anywhere else. "This
 * confirmation code has not been banked before" is a question about every other
 * row in the table, and checking it in a service means a read followed by a
 * write with a gap in between — two clerks entering the same forwarded SMS both
 * read "not present" and both insert. The gap is the bug, and the only way to
 * close it is to make the check and the write one operation. That is what a
 * unique index is.
 *
 * It is **partial** deliberately. Cheque numbers and bank references are not
 * unique: a client's own reference for two payments is routinely the same
 * string. Constraining the whole column would refuse legitimate rows to enforce
 * a rule that applies to one payment method.
 *
 * The **`CHECK`** mirrors the domain's `isReconcilable` — an M-Pesa payment
 * must carry a ten-character confirmation code — and is the backstop for
 * anything reaching the table without going through a schema: a fix-up script,
 * a psql session, an import written in two years by somebody who has not read
 * `domain/billing`.
 *
 * ## Why the CHECK is `NOT VALID`, which is the interesting part
 *
 * There is already a row that fails it. The seeded dataset recorded an M-Pesa
 * payment against INV-3001 with a reference of `INV-3001/1` — a synthetic
 * string invented to fill the column, which is precisely the falsehood this
 * constraint exists to stop. It is ten characters long and it is not a
 * confirmation code.
 *
 * The tempting fix is to `UPDATE` it to something valid in this migration. That
 * would be worse than the problem: **the system does not know what that
 * transaction's confirmation code was**, and writing a plausible one would turn
 * an obviously-wrong value into a convincingly-wrong one. The second is much
 * harder to find later and much more damaging when found — a reconciliation
 * that fails loudly is a task; one that matches the wrong transaction is a
 * misstatement.
 *
 * So the constraint is added `NOT VALID`, which is exactly the tool Postgres
 * provides for this situation and is routinely mistaken for a way of switching
 * a constraint off. It is not. **Every insert and every update from now on is
 * checked**; only the rows already there are left alone. The effect is that the
 * rule governs the system's behaviour immediately and the historical row stays
 * visibly wrong until somebody looks up the real code and corrects it.
 *
 * Finding them is one query, which is worth writing down here because whoever
 * has to do it will be reading this file:
 *
 * ```sql
 * SELECT i.number, p.received_on, p.amount_cents, p.reference
 *   FROM payments p JOIN invoices i ON i.id = p.invoice_id
 *  WHERE p.method = 'M-Pesa' AND p.reference !~ '^[A-Z0-9]{10}$';
 * ```
 *
 * Once that returns nothing, a one-line follow-up migration runs
 * `ALTER TABLE payments VALIDATE CONSTRAINT payments_mpesa_confirmed` and the
 * constraint covers the whole table. Re-running `db:seed` is enough for the
 * demo dataset, because `MPESA_CONFIRMATIONS` now supplies a code and the seed
 * rewrites the payment through the domain schema.
 *
 * This is the third refusal the database owns and the domain names — Rule 10 by
 * trigger, `cases.number` by unique index, and now this. The pattern is the
 * same each time: Postgres arbitrates because it is the only place the check
 * and the write are atomic, and the repository translates the refusal back into
 * the domain's own error so callers handle one shape.
 */
export const statements: readonly string[] = [
  /**
   * `reference IS NOT NULL AND …` rather than the regex alone, and the
   * redundant-looking half is the half that does the work.
   *
   * A `CHECK` is satisfied when its expression is *true or null*, and a
   * comparison against `NULL` yields `NULL`. Written as
   * `method <> 'M-Pesa' OR reference ~ '…'`, a row with `method = 'M-Pesa'` and
   * no reference at all evaluates to `FALSE OR NULL` — which is `NULL`, which
   * passes. The constraint would then refuse a *badly formatted* code and
   * accept a missing one, catching the typo and waving through the omission.
   *
   * That is precisely backwards, and it is exactly what the schema test found
   * before this line was written.
   */
  `
    ALTER TABLE payments ADD CONSTRAINT payments_mpesa_confirmed CHECK (
      method <> 'M-Pesa'
      OR (reference IS NOT NULL AND reference ~ '^[A-Z0-9]{10}$')
    ) NOT VALID;
  `,

  `
    CREATE UNIQUE INDEX payments_mpesa_confirmation
      ON payments (reference)
      WHERE method = 'M-Pesa';
  `,
];

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const statement of statements) {
    yield* sql.unsafe(statement);
  }
});
