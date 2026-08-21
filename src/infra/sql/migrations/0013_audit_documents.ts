import { SqlClient } from "@effect/sql";
import { Effect } from "effect";

/**
 * The document actions, added to the audit vocabulary.
 *
 * `document.filed` is separate from `document.revised`, and the distinction is
 * the one the domain already draws: filing a document with the court makes it
 * **fixed**. `addVersion` refuses to revise a filed document, because the
 * firm's copy and the court's copy differing under the same name is worse than
 * two clearly separate documents.
 *
 * So "who marked this as filed, and when" is a question with consequences —
 * it is the moment a document stopped being editable — and it needs its own
 * entry rather than being one more `document.revised` among many.
 */
export const statements: readonly string[] = [
  `
    ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'document.uploaded';
    ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'document.revised';
    ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'document.filed';

    ALTER TYPE audited_entity ADD VALUE IF NOT EXISTS 'document';
  `,
];

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const statement of statements) {
    yield* sql.unsafe(statement);
  }
});
