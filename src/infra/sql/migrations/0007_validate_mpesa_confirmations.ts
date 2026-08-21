import { SqlClient } from "@effect/sql";
import { Effect } from "effect";

/**
 * Closes the gap 0006 deliberately left open.
 *
 * `payments_mpesa_confirmed` was added `NOT VALID` because one seeded row could
 * not satisfy it — an M-Pesa payment carrying `INV-3001/1`, a synthetic
 * reference invented to fill a column. 0006 refused to invent a plausible code
 * in its place, for the reason written out there: a convincingly-wrong value is
 * worse than an obviously-wrong one.
 *
 * The row has since been corrected at source. `MPESA_CONFIRMATIONS` in the seed
 * supplement now supplies a code for that fee note, marked out loud as supplied
 * rather than discovered, and re-running `db:seed` rewrote the payment through
 * the domain schema. The query 0006 left for whoever had to do this returns
 * nothing.
 *
 * So the constraint is validated, and from here it covers **every** row rather
 * than every future row. `VALIDATE CONSTRAINT` takes only a `SHARE UPDATE
 * EXCLUSIVE` lock — it scans the table without blocking reads or writes — which
 * is the entire reason the two-step dance exists and is worth knowing: adding a
 * `CHECK` the ordinary way on a large table locks it for the duration of the
 * scan.
 *
 * A separate migration rather than an edit to 0006. Migrations are append-only:
 * editing one that has run leaves every database that already applied it
 * silently different from the file, and this one has run.
 */
export const statements: readonly string[] = [
  `ALTER TABLE payments VALIDATE CONSTRAINT payments_mpesa_confirmed;`,
];

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const statement of statements) {
    yield* sql.unsafe(statement);
  }
});
