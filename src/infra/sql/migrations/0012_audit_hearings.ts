import { SqlClient } from "@effect/sql";
import { Effect } from "effect";

/**
 * The court-diary actions, added to the audit vocabulary.
 *
 * `hearing.recorded` is separate from `hearing.scheduled` because they answer
 * different questions after the fact. "When was this matter listed, and by
 * whom" is administrative. "What was recorded as having happened on the day,
 * and when was it recorded" is the one asked after a matter is dismissed for
 * want of prosecution — and the gap between the hearing date and the entry's
 * timestamp is often the whole answer.
 */
export const statements: readonly string[] = [
  `
    ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'hearing.scheduled';
    ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'hearing.recorded';

    ALTER TYPE audited_entity ADD VALUE IF NOT EXISTS 'hearing';
  `,
];

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const statement of statements) {
    yield* sql.unsafe(statement);
  }
});
