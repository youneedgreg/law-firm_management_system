import { SqlClient, SqlSchema } from "@effect/sql";
import { Effect, Layer, Option, Schema } from "effect";
import { CaseId, TaskId } from "../../domain/shared/ids";
import type * as Work from "../../domain/work/task";
import {
  NotFound,
  type RepositoryFailure,
  TaskRepository,
} from "../../services/repositories";
import { reading, writing } from "./resilience";
import { TaskFromRow, taskRow } from "./task-model";

/**
 * Outstanding work, in Postgres.
 *
 * `open` is written against the `tasks_open_by_due` partial index — `status <>
 * 'Done'`, ordered by `due_on` — so the index is used rather than merely
 * present. The service then splits that one list into overdue and due-soon
 * against a single clock reading, which is why there is no `overdue()` here: two
 * queries would be two `now()`s, and a task can fall between them.
 *
 * `openCount` is a `count(*)`, not a `.length` on a list the caller does not
 * want. `CaseService` calls it before closing a matter, and closing a matter
 * with forty open tasks should not read forty rows to find that out.
 */
export const TaskRepositoryLive = Layer.effect(
  TaskRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const findById = SqlSchema.findOne({
      Request: TaskId,
      Result: TaskFromRow,
      execute: (id) => sql`SELECT * FROM tasks WHERE id = ${id}`,
    });

    const forCase = SqlSchema.findAll({
      Request: CaseId,
      Result: TaskFromRow,
      execute: (caseId) =>
        sql`SELECT * FROM tasks WHERE case_id = ${caseId} ORDER BY due_on`,
    });

    const open = SqlSchema.findAll({
      Request: Schema.Void,
      Result: TaskFromRow,
      execute: () =>
        sql`SELECT * FROM tasks WHERE status <> 'Done' ORDER BY due_on`,
    });

    return TaskRepository.of({
      byId: (id) =>
        findById(id).pipe(
          reading("TaskRepository.byId"),
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.fail(new NotFound({ entity: "Task", id })),
              onSome: Effect.succeed<Work.Task>,
            }),
          ),
        ),

      forCase: (caseId) =>
        forCase(caseId).pipe(reading("TaskRepository.forCase")),

      open: () => open().pipe(reading("TaskRepository.open")),

      openCount: (caseId) =>
        sql<{ count: string }>`
          SELECT count(*)::text AS count
            FROM tasks
           WHERE case_id = ${caseId} AND status <> 'Done'
        `.pipe(
          // `count(*)` is a bigint, and the driver hands those back as strings.
          Effect.map((rows) => Number(rows[0]?.count ?? 0)),
          reading("TaskRepository.openCount"),
        ),

      save: (task) =>
        Effect.sync(() => taskRow(task)).pipe(
          Effect.flatMap(
            (row) => sql`
              INSERT INTO tasks ${sql.insert(row)}
              ON CONFLICT (id) DO UPDATE SET ${sql.update(row, ["id"])}
            `,
          ),
          Effect.as(task),
          writing("TaskRepository.save"),
        ) satisfies Effect.Effect<Work.Task, RepositoryFailure>,
    });
  }),
);
