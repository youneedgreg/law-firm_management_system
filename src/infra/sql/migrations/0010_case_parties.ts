import { SqlClient } from "@effect/sql";
import { Effect } from "effect";

/**
 * Who the client is against.
 *
 * `domain/client/conflicts.ts` was written in Phase 1 and screens a prospective
 * retainer against the firm's matter history. It takes `MatterRecord` values
 * carrying structured parties — and until now **nothing could produce one**.
 * The only record of the other side was `cases.title`, free text of the form
 * "Wanjiku Mwangi v. Nairobi Metro SACCO", which is what a screen prints rather
 * than something a query can match on. The conflict screen was fully tested and
 * could not be run against real data.
 *
 * A `text[]` rather than a `case_parties` table, and the reasoning is the same
 * one that keeps the screen from returning a boolean. The screen matches on
 * *normalised names*; it never needs a party's own record. A table would force
 * a decision about what an opposing party *is* when they are also a client of
 * the firm — which is precisely the question the screen exists to raise for an
 * advocate, not to answer on its own authority.
 *
 * `DEFAULT '{}'` and `NOT NULL`, because an empty list is legitimate and
 * common: a conveyance, a probate application, an advisory retainer. Empty is
 * not missing, so the column is never null and the domain models it as an array
 * rather than an optional one.
 *
 * The `CHECK` refuses an empty name inside the array. A blank party name
 * normalises to the empty string, which the conflict screen would then match
 * against every enquiry — turning a screen that usefully over-reports into one
 * that reports everything, which is the same as reporting nothing.
 *
 * `'' <> ALL(...)` rather than the `NOT EXISTS (SELECT … FROM unnest(…))` this
 * was first written as: Postgres refuses a subquery in a check constraint, for
 * the good reason that a constraint has to be decidable from the row alone.
 * The array operator is decidable from the row and says the same thing.
 *
 * It catches the empty string and not `'   '`. That is not a gap, because
 * `NonEmptyTrimmedString` in the domain refuses a whitespace-only name outright
 * — `Trimmed` requires the value to already be trimmed, so `'   '` never
 * reaches here through a schema. This is the backstop for a fix-up script, and
 * the backstop's job is the case a script would plausibly produce.
 */
export const statements: readonly string[] = [
  `
    ALTER TABLE cases
      ADD COLUMN opposing_parties text[] NOT NULL DEFAULT '{}';

    ALTER TABLE cases ADD CONSTRAINT opposing_parties_named CHECK (
      '' <> ALL(opposing_parties)
    );
  `,
];

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const statement of statements) {
    yield* sql.unsafe(statement);
  }
});
