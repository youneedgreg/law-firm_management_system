import { SqlClient } from "@effect/sql";
import { Effect } from "effect";

/**
 * The time-tracking actions, added to the audit vocabulary.
 *
 * The second migration in Phase 7 to do this, and the pattern is now clear
 * enough to state as a rule: **a new `AuditAction` is a migration**. The schema
 * test added alongside 0008 compares the domain's `AUDIT_ACTIONS` against the
 * enum in both directions, so forgetting this fails a test in milliseconds
 * rather than a write in production — which is what the first one cost.
 *
 * `time.amended` exists separately from `time.recorded` because a corrected
 * time entry is the interesting one. Recording work is routine; changing what
 * was recorded after the fact — the narrative, the duration, whether it was
 * billable — is the entry a fee dispute turns on, and it needs its own name so
 * it can be searched for.
 *
 * There is deliberately no `time.invoiced`. Carrying time onto a fee note is
 * part of raising that fee note and is audited as `invoice.raised`, with the
 * entries in the snapshot: two entries for one act would make the trail read as
 * though something happened twice.
 */
export const statements: readonly string[] = [
  `
    ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'time.recorded';
    ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'time.amended';

    ALTER TYPE audited_entity ADD VALUE IF NOT EXISTS 'time';
  `,
];

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const statement of statements) {
    yield* sql.unsafe(statement);
  }
});
