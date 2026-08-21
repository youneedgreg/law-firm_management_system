import { SqlClient } from "@effect/sql";
import { Effect } from "effect";

/**
 * The client actions, added to the audit vocabulary.
 *
 * Two ordinary writes and one that is not: **`client.screened` records a
 * read**, and it is the only read this system audits.
 *
 * The rule stated in `domain/audit/entry.ts` is that reads are not audited,
 * because a row per page view buries the twelve entries that matter under a
 * hundred thousand that do not. A conflict screen is not a page view. It is a
 * professional act performed before a retainer is accepted, and "was a conflict
 * check run before this file was opened, and what did it show" is a question
 * asked afterwards, by somebody who was not there. An unrecorded screen is
 * indistinguishable from one that never happened.
 *
 * The entry carries the findings and the number of matters searched, so it says
 * what the advocate was looking at when they decided — not merely that they
 * looked.
 */
export const statements: readonly string[] = [
  `
    ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'client.opened';
    ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'client.amended';
    ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'client.screened';
  `,
];

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const statement of statements) {
    yield* sql.unsafe(statement);
  }
});
