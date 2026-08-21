import { Model } from "@effect/sql";
import { Option, ParseResult, Schema } from "effect";
import { AdvocateId, CaseId, TaskId } from "../../domain/shared/ids";
import * as Work from "../../domain/work/task";
import { CalendarDate } from "./columns";

/**
 * The `tasks` table, and the bridge to a `Task`.
 *
 * One disagreement between the two shapes, and it is the whole reason this file
 * is more than a field list.
 *
 * The domain has **one** optional value — `completed`, a `{ on, by }` pair. The
 * table has **two** nullable columns, `completed_on` and `completed_by`, plus a
 * `status` that has to agree with them. Three columns encoding one fact is
 * exactly where a row that contradicts itself comes from, so the mapping
 * refuses the contradictory combinations rather than trusting
 * `done_iff_completed` and `completion_is_whole` to have caught them.
 *
 * "The constraint should have prevented it" is not a reason to hand back a
 * `Task` marked `Done` with nobody's name against it — a screen would then
 * render "Completed by undefined", which is worse than an error.
 */
export class TaskRow extends Model.Class<TaskRow>("TaskRow")({
  id: TaskId,
  title: Schema.NonEmptyTrimmedString,
  caseId: Model.FieldOption(CaseId),
  assignedTo: AdvocateId,
  priority: Work.Priority,
  status: Work.Status,
  raisedOn: CalendarDate,
  dueOn: CalendarDate,
  completedOn: Model.FieldOption(CalendarDate),
  completedBy: Model.FieldOption(AdvocateId),
}) {}

/** The completion pair, as two columns. */
const flattenCompletion = (
  completed: Option.Option<Work.Completion>,
): {
  readonly completedOn: Option.Option<Date>;
  readonly completedBy: Option.Option<AdvocateId>;
} =>
  Option.isNone(completed)
    ? { completedOn: Option.none(), completedBy: Option.none() }
    : {
        completedOn: Option.some(completed.value.on),
        completedBy: Option.some(completed.value.by),
      };

export const TaskFromRow = Schema.transformOrFail(
  TaskRow.insert,
  Schema.typeSchema(Work.Task),
  {
    strict: true,

    decode: (row, _options, ast) => {
      const on = Option.getOrUndefined(row.completedOn);
      const by = Option.getOrUndefined(row.completedBy);

      /**
       * Half a completion record. `completion_is_whole` forbids the row; this
       * refuses to hand one back as a `Task`, because the alternative is a
       * screen showing a completion date with nobody's name against it.
       */
      if ((on === undefined) !== (by === undefined)) {
        return ParseResult.fail(
          new ParseResult.Type(
            ast,
            row,
            "the row records half a completion: a date with no name, or a " +
              "name with no date",
          ),
        );
      }

      /**
       * Status and completion disagreeing. `done_iff_completed` forbids it in
       * both directions and this refuses it in both directions, because either
       * way round the row means two things at once.
       */
      if ((row.status === "Done") !== (on !== undefined)) {
        return ParseResult.fail(
          new ParseResult.Type(
            ast,
            row,
            row.status === "Done"
              ? "the row is Done with no completion recorded"
              : `the row records a completion but its status is "${row.status}"`,
          ),
        );
      }

      return ParseResult.succeed({
        id: row.id,
        title: row.title,
        caseId: row.caseId,
        assignedTo: row.assignedTo,
        priority: row.priority,
        status: row.status,
        raisedOn: row.raisedOn,
        dueOn: row.dueOn,
        completed:
          on === undefined || by === undefined
            ? Option.none<Work.Completion>()
            : Option.some({ on, by }),
      });
    },

    encode: (task) =>
      ParseResult.succeed({
        id: task.id,
        title: task.title,
        caseId: task.caseId,
        assignedTo: task.assignedTo,
        priority: task.priority,
        status: task.status,
        raisedOn: task.raisedOn,
        dueOn: task.dueOn,
        ...flattenCompletion(task.completed),
      }),
  },
);

/**
 * A task, encoded for `sql.insert`.
 *
 * The same shape `paymentRow` exists for, and for the same reason: the Model's
 * *decoded* insert type carries `Option`s and `Date`s, and handing those to
 * `sql.insert` produces a driver error about an object it cannot serialise —
 * or, worse, a `Date` written where a `CalendarDate` was meant, which is how a
 * due date moves a day.
 */
export const taskRow: (task: Work.Task) => typeof TaskRow.insert.Encoded = (
  task,
) => Schema.encodeSync(TaskFromRow)(task);
