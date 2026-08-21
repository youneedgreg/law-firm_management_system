import { Either, Option, Schema } from "effect";
import { AdvocateId, CaseId, TaskId } from "../shared/ids";

/**
 * Work the firm has to do, and has not done yet.
 *
 * A task list is the easiest module in a system like this to build badly,
 * because a to-do list is trivial and a *law firm's* to-do list is not. Two
 * things make it different, and both are modelled here rather than left to a
 * screen.
 *
 * **A task can outlive the reason it was raised.** Matters close. When one
 * does, the tasks on it do not stop existing — they stop being *work*, and a
 * list that keeps showing "file the decree absolute" on a matter closed three
 * months ago is a list people stop reading. That is the failure this module is
 * arranged around, and it is handled by refusing to raise or reopen work on a
 * closed matter rather than by filtering the list afterwards.
 *
 * **Not every task belongs to a matter.** "Reconcile the trust account" is
 * firm work, and it is the task most likely to matter and least likely to have
 * a file number. So `caseId` is an `Option` — deliberately unlike `TimeEntry`,
 * where time with no matter is unbillable and the domain has nowhere to put it.
 * The difference is real: unattributed *time* is a gap in the billing record,
 * and unattributed *work* is just work.
 */

export const PRIORITIES = ["Low", "Medium", "High"] as const;

export const Priority = Schema.Literal(...PRIORITIES);
export type Priority = typeof Priority.Type;

/**
 * `Not started`, `In progress`, `Done` — and deliberately not `Scheduled`.
 *
 * The prototype had a fourth value, and it was not a state of the work: it was
 * the presence of a date. Every task here has a due date, so `Scheduled` would
 * be true of all of them; the one prototype task carrying it was "Attend
 * hearing", which is a court date, and the court diary owns those. Keeping it
 * would have made "how many tasks are outstanding" — the dashboard's one
 * question about this module — unanswerable without a convention nobody wrote
 * down.
 */
export const STATUSES = ["Not started", "In progress", "Done"] as const;

export const Status = Schema.Literal(...STATUSES);
export type Status = typeof Status.Type;

/**
 * Who did it, and when.
 *
 * Completion is a pair, not a flag. "Done" on its own cannot answer the
 * question people actually ask afterwards — *when* was the registry filing
 * made, and who says so — and a boolean beside two nullable columns is three
 * facts that can disagree. The `filter` below makes the disagreement
 * unrepresentable.
 */
export const Completion = Schema.Struct({
  on: Schema.DateFromSelf,
  by: AdvocateId,
});

export type Completion = typeof Completion.Type;

/**
 * Exported so `api/wire.ts` can rebuild this struct without restating it.
 *
 * The same arrangement `PaymentFields` has next door, and for the same reason:
 * `Schema.filter` produces a refinement, and a refinement has no `.fields` to
 * spread. Anything that needs to re-declare the shape — the wire schema, which
 * swaps two `Date`s for ISO strings — takes the fields and re-applies
 * `doneIffCompleted`, so the invariant crosses the boundary rather than being
 * quietly dropped on the way out.
 */
export const TaskFields = {
  id: TaskId,
  title: Schema.NonEmptyTrimmedString,
  /** Absent for firm work — reconciling the trust account, a training day. */
  caseId: Schema.Option(CaseId),
  assignedTo: AdvocateId,
  priority: Priority,
  status: Status,
  raisedOn: Schema.DateFromSelf,
  dueOn: Schema.DateFromSelf,
  completed: Schema.Option(Completion),
};

/**
 * The invariant: `Done` if and only if there is a completion record.
 *
 * Both halves matter. A task marked done with nothing recorded loses the only
 * two facts anyone wants later; a task with a completion record but a status of
 * `In progress` is a row that contradicts itself, which is what happens when a
 * status is edited directly instead of through `complete`.
 *
 * A `filter` rather than a union, because every other field is shared and the
 * two shapes differ by one optional. Postgres says the same thing in
 * `done_iff_completed`.
 */
export const doneIffCompleted = <
  A extends {
    readonly status: Status;
    readonly completed: Option.Option<unknown>;
  },
>(
  task: A,
) =>
  (task.status === "Done") === Option.isSome(task.completed)
    ? undefined
    : {
        path: ["completed"] as const,
        message:
          "a task is Done exactly when it has a completion record: " +
          "'Done' with nothing recorded loses who and when, and a record " +
          "under any other status is a row contradicting itself",
      };

export const Task = Schema.Struct(TaskFields).pipe(
  Schema.filter(doneIffCompleted),
);

export type Task = typeof Task.Type;

export const isOpen = (task: Task): boolean => task.status !== "Done";

/** Open work whose due date has passed. The list this module exists for. */
export const overdue = (tasks: readonly Task[], asAt: Date): readonly Task[] =>
  tasks.filter(
    (task) => isOpen(task) && task.dueOn.getTime() < startOfDay(asAt).getTime(),
  );

/**
 * Open work due today or in the next `days` days.
 *
 * Bounded rather than open-ended, because "everything due eventually" is the
 * whole list again. Overdue work is excluded — it has its own list, and a task
 * that appeared in both would be counted twice by anything summing them.
 */
export const dueWithin = (
  tasks: readonly Task[],
  asAt: Date,
  days: number,
): readonly Task[] => {
  const from = startOfDay(asAt).getTime();
  const until = from + days * 24 * 60 * 60 * 1000;

  return tasks.filter(
    (task) =>
      isOpen(task) &&
      task.dueOn.getTime() >= from &&
      task.dueOn.getTime() <= until,
  );
};

/**
 * Midnight UTC.
 *
 * A task due today is not overdue at nine in the morning, which is what a
 * straight `dueOn < now` comparison would say. Due dates are days, not
 * instants — the domain stores them as `date` in Postgres — so the comparison
 * has to be against the start of the day rather than the moment of asking.
 */
const startOfDay = (at: Date): Date =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));

export class AlreadyDone extends Schema.TaggedError<AlreadyDone>()(
  "AlreadyDone",
  { title: Schema.String, completedOn: Schema.Date },
) {
  get reason(): string {
    return `"${this.title}" was already completed on ${this.completedOn.toISOString().slice(0, 10)}`;
  }
}

export class NotDone extends Schema.TaggedError<NotDone>()("NotDone", {
  title: Schema.String,
}) {
  get reason(): string {
    return `"${this.title}" is not complete, so there is nothing to reopen`;
  }
}

export class DueBeforeRaised extends Schema.TaggedError<DueBeforeRaised>()(
  "DueBeforeRaised",
  { raisedOn: Schema.Date, dueOn: Schema.Date },
) {
  get reason(): string {
    return (
      `a task cannot be due (${this.dueOn.toISOString().slice(0, 10)}) before ` +
      `it was raised (${this.raisedOn.toISOString().slice(0, 10)}) — this is ` +
      `almost always a mistyped year, and it would appear as overdue the ` +
      `moment it was saved`
    );
  }
}

/**
 * Marks a task done.
 *
 * The completion record is written here rather than accepted from the caller,
 * so "who" is whoever performed the act and not whoever was typed into a form
 * — the same reasoning that keeps a fee-earner field off the timesheet.
 */
export const complete = (
  task: Task,
  by: AdvocateId,
  on: Date,
): Either.Either<Task, AlreadyDone> =>
  Option.isSome(task.completed)
    ? Either.left(
        new AlreadyDone({
          title: task.title,
          completedOn: task.completed.value.on,
        }),
      )
    : Either.right({
        ...task,
        status: "Done" as const,
        completed: Option.some({ on, by }),
      });

/**
 * Reopens a completed task.
 *
 * It returns to `In progress` rather than `Not started`, because it is not
 * true that nothing has been done — somebody thought it was finished. The
 * completion record is *discarded* rather than kept as history, which is a
 * deliberate limit of this module and worth naming: a task is a note to
 * ourselves about work, not evidence about the world, so it does not get the
 * append-only treatment a document or a hearing outcome gets. If a completion
 * that was later reversed ever needs to be provable, the audit trail already
 * has both entries.
 */
export const reopen = (task: Task): Either.Either<Task, NotDone> =>
  Option.isNone(task.completed)
    ? Either.left(new NotDone({ title: task.title }))
    : Either.right({
        ...task,
        status: "In progress" as const,
        completed: Option.none(),
      });

/** Raises a task, refusing a due date behind the day it was raised. */
export const raise = (
  fields: Omit<Task, "status" | "completed">,
): Either.Either<Task, DueBeforeRaised> =>
  fields.dueOn.getTime() < startOfDay(fields.raisedOn).getTime()
    ? Either.left(
        new DueBeforeRaised({
          raisedOn: fields.raisedOn,
          dueOn: fields.dueOn,
        }),
      )
    : Either.right({
        ...fields,
        status: "Not started" as const,
        completed: Option.none(),
      });

/**
 * Highest priority first, then soonest due, then title.
 *
 * The ordering is in the domain rather than in a query or a screen because it
 * encodes a judgement — that urgency beats deadline — and two screens sorting
 * the same list differently is how a firm ends up arguing about which one is
 * right.
 */
const RANK: Readonly<Record<Priority, number>> = {
  High: 0,
  Medium: 1,
  Low: 2,
};

export const byUrgency = (tasks: readonly Task[]): readonly Task[] =>
  [...tasks].sort(
    (a, b) =>
      RANK[a.priority] - RANK[b.priority] ||
      a.dueOn.getTime() - b.dueOn.getTime() ||
      a.title.localeCompare(b.title),
  );
