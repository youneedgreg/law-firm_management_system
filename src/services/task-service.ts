import { DateTime, Effect, Either, Option, Schema } from "effect";
import * as Matter from "../domain/case/case";
import type { NotPermitted } from "../domain/identity/permissions";
import type { Principal } from "../domain/identity/principal";
import { AdvocateId, CaseId, TaskId } from "../domain/shared/ids";
import * as Work from "../domain/work/task";
import { AuditLog } from "./audit-service";
import { type CurrentUser, permitted, withinScope } from "./policy";
import {
  AdvocateRepository,
  CaseRepository,
  type NotFound,
  type RepositoryFailure,
  TaskRepository,
  Transactor,
} from "./repositories";

/**
 * The firm's work list.
 *
 * ## Why this is not a to-do list with a database behind it
 *
 * Three things here are about a law firm rather than about tasks.
 *
 * **Nobody assigns work to themselves by accident, and nobody completes it on
 * somebody else's behalf.** A task is assigned to a named advocate, chosen
 * deliberately; a completion is attributed to whoever performed the act, never
 * to whoever was typed into a form. Those are opposite defaults and both are
 * right: assignment is a decision about another person, and completion is a
 * statement about yourself.
 *
 * **Work on a closed matter is not work.** `raise` refuses it and `reopen`
 * refuses it, rather than the list filtering closed matters out afterwards —
 * a filter leaves the row there, quietly, to reappear when somebody reopens the
 * matter or writes a report that forgets the same filter.
 *
 * **A matter cannot be closed over the top of open work.** That is the rule
 * with the most consequence in this module and it lives in `CaseService`, where
 * closing happens; this service supplies the count it asks for. "File the
 * decree absolute" left open on a matter closed last March is a task that will
 * now never be done by anyone, because nothing will ever show it again.
 */

// ── What the screens read ─────────────────────────────────────────────────

/** A task with the matter it sits on, and the person carrying it. */
export interface TaskSummary {
  readonly task: Work.Task;
  /** Absent for firm work — reconciling the trust account, a training day. */
  readonly matter: Option.Option<{
    readonly id: CaseId;
    readonly number: string;
    readonly title: string;
  }>;
  readonly assigneeName: string;
}

/** Who work can be given to, and what it can be put on. */
export interface TaskChoices {
  readonly matters: readonly {
    readonly id: CaseId;
    readonly number: string;
    readonly title: string;
  }[];
  readonly staff: readonly {
    readonly id: AdvocateId;
    readonly name: string;
  }[];
}

/**
 * The work list, split once.
 *
 * Three lists from **one read and one clock reading**. Two queries would be two
 * `now()`s, and a task can fall between them — appearing in neither list, or in
 * both, depending on how long a round trip took. The hearing diary avoids the
 * same bug the same way, and the reason is worth repeating: these lists get
 * summed, and a task counted twice is a number nobody can reconcile.
 */
export interface WorkList {
  readonly overdue: readonly TaskSummary[];
  readonly dueSoon: readonly TaskSummary[];
  readonly later: readonly TaskSummary[];
  /** Everything open, however far off. What the dashboard counts. */
  readonly openCount: number;
}

/** Due "soon" is the working week ahead. */
const SOON_DAYS = 7;

// ── What the boundary accepts ─────────────────────────────────────────────

/**
 * Raising a task.
 *
 * `raisedOn` is absent, and `status` and `completed` with it: a task is raised
 * *now*, by definition, and starts not started. A caller choosing its raising
 * date could produce work that was overdue before it existed, which is the one
 * thing `DueBeforeRaised` exists to prevent.
 */
export const RaiseTask = Schema.Struct({
  title: Schema.NonEmptyTrimmedString,
  caseId: Schema.OptionFromNullishOr(CaseId, null),
  assignedTo: AdvocateId,
  priority: Work.Priority,
  dueOn: Schema.Date,
});

export type RaiseTask = typeof RaiseTask.Type;

// ── Failures this layer adds ──────────────────────────────────────────────

/**
 * Work raised on, or reopened onto, a matter that is closed.
 *
 * The domain's error, not a second one with the same tag — see
 * `Matter.MatterIsClosed`. Refused rather than filtered out of the list: a
 * filter leaves the row in the table to reappear the moment somebody reopens
 * the matter or writes a report that forgets the same filter, and "why is
 * there a task on a matter we closed in March" is a question with no good
 * answer.
 */
/**
 * The domain's error, re-exported as a **type only**.
 *
 * It was `export const MatterIsClosed = Matter.MatterIsClosed` — an alias
 * evaluated when the module loads — and that failed at runtime with
 * "Matter is not defined": dereferencing a namespace at module-evaluation time
 * depends on the bundler's chunk ordering, which nothing here controls.
 * Construction sites say `new Matter.MatterIsClosed(…)` instead, which is
 * resolved when it runs rather than when it loads.
 *
 * The type alias is safe because it is erased.
 */
export type MatterIsClosed = Matter.MatterIsClosed;

/** Only somebody with a staff record can be assigned work, or complete it. */
export class NotAssignable extends Schema.TaggedError<NotAssignable>()(
  "NotAssignable",
  { name: Schema.String },
) {
  get reason(): string {
    return `${this.name} has no staff record, so work cannot be attributed to them`;
  }
}

/**
 * `NotAssignable` is deliberately **not** here.
 *
 * Raising a task looks up the assignee through `AdvocateRepository`, so an
 * unknown one is a `NotFound` — the id names nobody. `NotAssignable` is a
 * different statement: it says the person *signed in* has no staff record, and
 * only `complete` can produce it, because only a completion is attributed to
 * whoever performed the act.
 *
 * Listing it here anyway would have been harmless to the compiler and wrong on
 * the wire: the contract declares an error the endpoint cannot return, and a
 * generated client grows a branch that is unreachable.
 */
export type CannotRaise =
  | NotPermitted
  | NotFound
  | MatterIsClosed
  | Work.DueBeforeRaised
  | RepositoryFailure;

// ── Internals ─────────────────────────────────────────────────────────────

const enforce = <A, E>(result: Either.Either<A, E>): Effect.Effect<A, E> =>
  Either.match(result, {
    onLeft: Effect.fail<E>,
    onRight: Effect.succeed<A>,
  });

/**
 * The staff record behind whoever is signed in.
 *
 * A portal user has none, and neither does a system administrator — which is
 * correct: an administrator manages logins and does not carry a matter. A
 * completion has to name a person on the staff list, so this is the boundary
 * where "signed in" becomes "can be recorded as having done it".
 */
const actingAdvocate = (
  principal: Principal,
): Effect.Effect<AdvocateId, NotAssignable> =>
  principal._tag === "Staff"
    ? Effect.succeed(principal.advocateId)
    : Effect.fail(new NotAssignable({ name: principal.name }));

const taskId = (): TaskId => Schema.decodeSync(TaskId)(crypto.randomUUID());

// ── The service ───────────────────────────────────────────────────────────

export class TaskService extends Effect.Service<TaskService>()("TaskService", {
  effect: Effect.gen(function* () {
    const tasks = yield* TaskRepository;
    const cases = yield* CaseRepository;
    const advocates = yield* AdvocateRepository;
    const audit = yield* AuditLog;
    const transactor = yield* Transactor;

    /**
     * One task, scoped through the matter it sits on.
     *
     * Firm work has no matter and therefore no client, so there is nothing to
     * scope it against — which is fine, because a portal user holds neither
     * `task:read` nor `task:write` and never reaches here. If the portal ever
     * gains a view of its own tasks, this is the line that has to change, and
     * it will fail to compile rather than quietly leak.
     */
    const scoped = (id: TaskId, permission: "task:read" | "task:write") =>
      Effect.gen(function* () {
        const principal = yield* permitted(permission);
        const task = yield* tasks.byId(id);

        if (Option.isSome(task.caseId)) {
          const matter = yield* cases.byId(task.caseId.value);
          yield* withinScope("task", id, matter.clientId);
        }

        return { task, principal };
      });

    /**
     * The matter a task is being put on, checked for being open.
     *
     * `Option.none` — firm work — passes, because there is no matter to be
     * closed. That is the branch worth naming: it is not an oversight that firm
     * work skips this check, it is that the check has nothing to be about.
     */
    const openMatter = (caseId: Option.Option<CaseId>) =>
      Option.isNone(caseId)
        ? Effect.void
        : Effect.gen(function* () {
            const matter = yield* cases.byId(caseId.value);
            yield* withinScope("case", caseId.value, matter.clientId);

            if (matter.status === "Closed") {
              return yield* Effect.fail(
                new Matter.MatterIsClosed({
                  number: matter.number,
                  attempted: "raise work on it",
                }),
              );
            }
          });

    /** Resolves matters and assignee names for a list of tasks, in one pass. */
    const summarise = (
      list: readonly Work.Task[],
    ): Effect.Effect<readonly TaskSummary[], RepositoryFailure, CurrentUser> =>
      Effect.gen(function* () {
        /**
         * Only the matters and advocates this list actually names.
         *
         * Reading every matter to label eight tasks is a read nobody asked for,
         * and — on the portal side, if these ever become visible there — a read
         * nobody is entitled to.
         */
        const [everyMatter, everyAdvocate] = yield* Effect.all(
          [cases.all(), advocates.all()],
          { concurrency: "unbounded" },
        );

        const matters = new Map(
          everyMatter.map((matter) => [matter.id, matter] as const),
        );
        const names = new Map(
          everyAdvocate.map((advocate) => [advocate.id, advocate.name]),
        );

        return Work.byUrgency(list).map((task): TaskSummary => {
          const matter = Option.flatMap(task.caseId, (id) =>
            Option.fromNullable(matters.get(id)),
          );

          return {
            task,
            matter: Option.map(matter, (found) => ({
              id: found.id,
              number: found.number,
              title: found.title,
            })),
            /**
             * A missing name is shown, not thrown. The foreign key makes it
             * impossible in Postgres, and a work list should not fail to render
             * because one row is odd.
             */
            assigneeName: names.get(task.assignedTo) ?? "Unassigned",
          };
        });
      });

    return {
      /**
       * Everything outstanding, split into overdue, due soon, and later.
       *
       * One read, one clock reading, three lists — see `WorkList`. `later` is
       * derived by subtraction rather than by a third predicate, so the three
       * are exhaustive and disjoint by construction: a task cannot fall out of
       * all of them because somebody wrote `>` where they meant `>=`.
       */
      workList: (): Effect.Effect<
        WorkList,
        NotPermitted | RepositoryFailure,
        CurrentUser
      > =>
        Effect.gen(function* () {
          yield* permitted("task:read");

          const [open, now] = yield* Effect.all([
            tasks.open(),
            DateTime.nowAsDate,
          ]);

          const overdue = Work.overdue(open, now);
          const dueSoon = Work.dueWithin(open, now, SOON_DAYS);

          const accounted = new Set(
            [...overdue, ...dueSoon].map((task) => task.id),
          );
          const later = open.filter((task) => !accounted.has(task.id));

          const [a, b, c] = yield* Effect.all(
            [summarise(overdue), summarise(dueSoon), summarise(later)],
            { concurrency: "unbounded" },
          );

          return {
            overdue: a,
            dueSoon: b,
            later: c,
            openCount: open.length,
          };
        }),

      /**
       * What the "raise a task" form can offer.
       *
       * Gated on `task:write` rather than on `case:open`, and that difference
       * is the reason this exists at all instead of borrowing
       * `CaseService.intakeChoices`. A Legal Assistant and a Finance Officer
       * both raise work and neither may open a matter; asking for intake's
       * choices would refuse them, and widening intake's gate to suit a
       * dropdown would hand a portal user the firm's client list.
       *
       * **Only open matters.** A closed one would be offered and then refused,
       * which is a worse experience than one that was never in the list — the
       * same reasoning that keeps departed staff out of it.
       */
      choices: (): Effect.Effect<
        TaskChoices,
        NotPermitted | RepositoryFailure,
        CurrentUser
      > =>
        Effect.gen(function* () {
          yield* permitted("task:write");

          const [openMatters, everyAdvocate] = yield* Effect.all(
            [cases.openMatters(), advocates.all()],
            { concurrency: "unbounded" },
          );

          return {
            matters: openMatters
              .map((matter) => ({
                id: matter.id,
                number: matter.number,
                title: matter.title,
              }))
              .sort((a, b) => a.number.localeCompare(b.number)),
            staff: everyAdvocate
              .filter((advocate) => advocate.active)
              .map((advocate) => ({ id: advocate.id, name: advocate.name }))
              .sort((a, b) => a.name.localeCompare(b.name)),
          };
        }),

      /** Every task on one matter, done included — a matter file shows both. */
      forCase: (
        caseId: CaseId,
      ): Effect.Effect<
        readonly TaskSummary[],
        NotPermitted | NotFound | RepositoryFailure,
        CurrentUser
      > =>
        Effect.gen(function* () {
          yield* permitted("task:read");
          const matter = yield* cases.byId(caseId);
          yield* withinScope("case", caseId, matter.clientId);

          return yield* summarise(yield* tasks.forCase(caseId));
        }),

      /**
       * Raises a task.
       *
       * The assignee is chosen by the caller and checked against the staff
       * list — work is given to a named person deliberately, which is the
       * opposite default from completion, where the actor is whoever performed
       * the act. Both are right, for the reason given at the top of this file.
       */
      raise: (
        input: RaiseTask,
      ): Effect.Effect<Work.Task, CannotRaise, CurrentUser> =>
        Effect.gen(function* () {
          yield* permitted("task:write");
          yield* openMatter(input.caseId);

          // Assigned to somebody who is actually on the staff list, and
          // actually still here.
          const assignee = yield* advocates.byId(input.assignedTo);

          const raisedOn = yield* DateTime.nowAsDate;
          const task = yield* enforce(
            Work.raise({
              id: taskId(),
              title: input.title,
              caseId: input.caseId,
              assignedTo: assignee.id,
              priority: input.priority,
              raisedOn,
              dueOn: input.dueOn,
            }),
          );

          return yield* transactor.transaction(
            Effect.gen(function* () {
              const saved = yield* tasks.save(task);
              yield* audit.record({
                action: "task.raised",
                entity: "task",
                entityId: saved.id,
                after: saved,
              });
              return saved;
            }),
          );
        }),

      /**
       * Marks a task done, attributed to whoever is signed in.
       *
       * "Who" is not a parameter. A completion recorded on somebody else's
       * behalf is a claim about them that they did not make — the same
       * reasoning that keeps a fee-earner dropdown off the timesheet.
       */
      complete: (
        id: TaskId,
      ): Effect.Effect<
        Work.Task,
        | NotPermitted
        | NotFound
        | NotAssignable
        | Work.AlreadyDone
        | RepositoryFailure,
        CurrentUser
      > =>
        Effect.gen(function* () {
          const { task, principal } = yield* scoped(id, "task:write");
          const by = yield* actingAdvocate(principal);
          const on = yield* DateTime.nowAsDate;

          const done = yield* enforce(Work.complete(task, by, on));

          return yield* transactor.transaction(
            Effect.gen(function* () {
              const saved = yield* tasks.save(done);
              yield* audit.record({
                action: "task.completed",
                entity: "task",
                entityId: saved.id,
                before: task,
                after: saved,
              });
              return saved;
            }),
          );
        }),

      /**
       * Reopens a completed task.
       *
       * The domain discards the completion record, so **the audit trail is the
       * only place the reversal survives** — which is why both `task.completed`
       * and `task.reopened` are recorded rather than just this one. A task is a
       * note to ourselves about work rather than evidence about the world, and
       * does not get the append-only treatment a document or a hearing outcome
       * gets; the trail is what makes that trade affordable.
       *
       * Reopening onto a closed matter is refused, exactly as raising is.
       */
      reopen: (
        id: TaskId,
      ): Effect.Effect<
        Work.Task,
        | NotPermitted
        | NotFound
        | MatterIsClosed
        | Work.NotDone
        | RepositoryFailure,
        CurrentUser
      > =>
        Effect.gen(function* () {
          const { task } = yield* scoped(id, "task:write");
          yield* openMatter(task.caseId);

          const reopened = yield* enforce(Work.reopen(task));

          return yield* transactor.transaction(
            Effect.gen(function* () {
              const saved = yield* tasks.save(reopened);
              yield* audit.record({
                action: "task.reopened",
                entity: "task",
                entityId: saved.id,
                before: task,
                after: saved,
              });
              return saved;
            }),
          );
        }),

      /**
       * Hands a task to somebody else.
       *
       * Its own operation and its own audit action rather than a general
       * amendment, because "who was this given to, and when did that change" is
       * the question asked when a deadline is missed — and it should not require
       * reading a diff to answer.
       */
      reassign: (
        id: TaskId,
        to: AdvocateId,
      ): Effect.Effect<
        Work.Task,
        NotPermitted | NotFound | Work.AlreadyDone | RepositoryFailure,
        CurrentUser
      > =>
        Effect.gen(function* () {
          const { task } = yield* scoped(id, "task:write");

          /**
           * Reassigning finished work changes nothing about who did it, and
           * would leave a completion record naming one person under an
           * assignment naming another.
           */
          if (Option.isSome(task.completed)) {
            return yield* Effect.fail(
              new Work.AlreadyDone({
                title: task.title,
                completedOn: task.completed.value.on,
              }),
            );
          }

          const assignee = yield* advocates.byId(to);
          const moved = { ...task, assignedTo: assignee.id };

          return yield* transactor.transaction(
            Effect.gen(function* () {
              const saved = yield* tasks.save(moved);
              yield* audit.record({
                action: "task.reassigned",
                entity: "task",
                entityId: saved.id,
                before: task,
                after: saved,
              });
              return saved;
            }),
          );
        }),
    };
  }),
}) {}
