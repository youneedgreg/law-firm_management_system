import { SqlClient } from "@effect/sql";
import { Effect } from "effect";

/**
 * The task list — the last table in Phase 7 that is genuinely new.
 *
 * Everything else this phase touched already had a table from `0001`. Tasks
 * did not: the prototype kept them in a TypeScript array with a string for the
 * matter, a string for the assignee and a string for the due date, which is
 * three foreign keys the database never got to check.
 *
 * Three decisions are worth reading the DDL for.
 *
 * **`case_id` is nullable, and that is a feature.** "Reconcile the trust
 * account" is firm work with no file number. Compare `time_entries.case_id`,
 * which is `NOT NULL`: unattributed *time* is a hole in the billing record, and
 * unattributed *work* is just work.
 *
 * **`ON DELETE CASCADE` from `cases`,** matching documents and time entries. A
 * task exists to get a matter done; if the matter is gone the task is not
 * merely unassigned, it is meaningless.
 *
 * **`done_iff_completed` is the schema's copy of the domain invariant.** A
 * status column beside two nullable columns is three facts that can disagree,
 * and the disagreement is not hypothetical — it is what a hand-written
 * `UPDATE tasks SET status = 'Done'` produces. The domain's `Schema.filter`
 * says the same thing; this is what says it to anything that is not this
 * application.
 */

export const statements: readonly string[] = [
  `
    CREATE TYPE task_priority AS ENUM ('Low', 'Medium', 'High');
    CREATE TYPE task_status AS ENUM ('Not started', 'In progress', 'Done');

    CREATE TABLE tasks (
      id           uuid PRIMARY KEY,
      title        text NOT NULL CHECK (btrim(title) <> ''),

      -- Null for firm work. See the note above; this is the one place in the
      -- schema where an absent matter is correct rather than a gap.
      case_id      uuid REFERENCES cases (id) ON DELETE CASCADE,

      assigned_to  uuid NOT NULL REFERENCES advocates (id) ON DELETE RESTRICT,
      priority     task_priority NOT NULL,
      status       task_status NOT NULL,

      -- Days, not instants. A task is due *on the 20th*, not at a moment on the
      -- 20th, and storing a timestamp would make "is this overdue" depend on
      -- the reader's time zone.
      raised_on    date NOT NULL,
      due_on       date NOT NULL,

      completed_on date,
      completed_by uuid REFERENCES advocates (id) ON DELETE RESTRICT,

      CONSTRAINT due_after_raised CHECK (due_on >= raised_on),

      -- The completion pair travels together or not at all.
      CONSTRAINT completion_is_whole CHECK (
        (completed_on IS NULL) = (completed_by IS NULL)
      ),

      -- Done exactly when completed. Written as an equivalence rather than two
      -- implications so it reads the way the rule is stated.
      CONSTRAINT done_iff_completed CHECK (
        (status = 'Done') = (completed_on IS NOT NULL)
      )
    );

    -- The two reads the screens make: one matter's tasks, and open work by due
    -- date. The second is partial because a done task is never in either list,
    -- and there will eventually be far more done tasks than open ones.
    CREATE INDEX tasks_by_case ON tasks (case_id);
    CREATE INDEX tasks_open_by_due ON tasks (due_on)
      WHERE status <> 'Done';
  `,

  `
    ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'task.raised';
    ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'task.reassigned';
    ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'task.completed';
    ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'task.reopened';

    ALTER TYPE audited_entity ADD VALUE IF NOT EXISTS 'task';
  `,
];

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const statement of statements) {
    yield* sql.unsafe(statement);
  }
});
