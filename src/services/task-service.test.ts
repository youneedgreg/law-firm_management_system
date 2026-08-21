import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Ref, TestClock } from "effect";
import {
  advocates,
  asAdvocate,
  asFinance,
  asPartner,
  asReceptionist,
  asWanjiku,
  clients,
  closedMatter,
  doneTask,
  dueToday,
  filedMatter,
  firmChore,
  grace,
  matters,
  overdueTask,
  sarah,
  tasks,
  TODAY,
} from "../../test/fixtures";
import {
  casesWithStore,
  inMemoryAdvocates,
  inMemoryAudit,
  inMemoryClients,
  inMemoryTransactor,
  restorable,
  tasksWithStore,
} from "../../test/in-memory-repositories";
import type * as Firm from "../domain/firm/advocate";
import type { Principal } from "../domain/identity/principal";
import * as Work from "../domain/work/task";
import { AuditLog } from "./audit-service";
import { CaseService } from "./case-service";
import { CurrentUser } from "./policy";
import { RaiseTask, TaskService } from "./task-service";

/**
 * `TaskService`, over arrays.
 *
 * The properties worth testing here are the ones that need *stored* state to
 * decide: work cannot be raised on a closed matter, a matter cannot be closed
 * over open work, and the three lists a work screen shows are derived from one
 * read so that a task cannot appear in two of them or in none.
 */

const firm = (
  seed: readonly Work.Task[] = tasks,
  staff: readonly Firm.Advocate[] = advocates,
) => {
  const store = tasksWithStore(seed);
  const cases = casesWithStore(matters);
  const audit = inMemoryAudit();

  return {
    store,
    cases,
    audit,
    layer: Layer.mergeAll(
      TaskService.Default,
      CaseService.Default,
      AuditLog.Default,
    ).pipe(
      Layer.provideMerge(AuditLog.Default),
      Layer.provideMerge(
        Layer.mergeAll(
          store.layer,
          cases.layer,
          inMemoryClients(clients),
          inMemoryAdvocates(staff),
          audit.layer,
          inMemoryTransactor(restorable(store.store)),
        ),
      ),
    ),
  };
};

const scenario = <A, E>(
  body: Effect.Effect<A, E, TaskService | CaseService | AuditLog | CurrentUser>,
  options: {
    readonly as?: Principal;
    readonly seed?: readonly Work.Task[];
    readonly staff?: readonly Firm.Advocate[];
  } = {},
) =>
  TestClock.setTime(TODAY).pipe(
    Effect.andThen(body),
    Effect.provideService(CurrentUser, options.as ?? asAdvocate),
    Effect.provide(firm(options.seed, options.staff).layer),
  );

const onMatter: RaiseTask = {
  title: "Prepare the bundle",
  caseId: Option.some(filedMatter.id),
  assignedTo: sarah.id,
  priority: "High",
  dueOn: new Date("2026-08-26T00:00:00.000Z"),
};

// ── Raising ───────────────────────────────────────────────────────────────

describe("raising work", () => {
  it.effect("starts it not started, and unattributed", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* TaskService;
        const raised = yield* service.raise(onMatter);

        expect(raised.title).toBe("Prepare the bundle");
        expect(raised.status).toBe("Not started");
        expect(Option.isNone(raised.completed)).toBe(true);
        // Raised now, from the clock, not from the request.
        expect(raised.raisedOn).toStrictEqual(TODAY);
      }),
    ),
  );

  /**
   * Firm work has no matter, and that is correct rather than a gap. Compare a
   * time entry, where `case_id` is `NOT NULL`: unattributed *time* is a hole in
   * the billing record, and unattributed *work* is just work.
   */
  it.effect("raises firm work with no matter behind it", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* TaskService;
        const raised = yield* service.raise({
          ...onMatter,
          title: "Reconcile the trust account",
          caseId: Option.none(),
        });

        expect(Option.isNone(raised.caseId)).toBe(true);
      }),
    ),
  );

  /**
   * **The rule this module exists for, on the way in.**
   *
   * Refused rather than filtered out of the list afterwards. A filter leaves
   * the row in the table to reappear the moment somebody reopens the matter, or
   * writes a report that forgets the same filter.
   */
  it.effect("refuses work on a matter that is closed", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* TaskService;
        const refused = yield* Effect.flip(
          service.raise({ ...onMatter, caseId: Option.some(closedMatter.id) }),
        );

        expect(refused._tag).toBe("MatterIsClosed");
        if (refused._tag === "MatterIsClosed") {
          expect(refused.reason).toContain("Reopen the matter first");
        }
      }),
    ),
  );

  it.effect("refuses a due date behind the day it was raised", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* TaskService;
        const refused = yield* Effect.flip(
          service.raise({
            ...onMatter,
            dueOn: new Date("2025-08-26T00:00:00.000Z"),
          }),
        );

        expect(refused._tag).toBe("DueBeforeRaised");
      }),
    ),
  );

  /**
   * Work is assigned to a *named* person, checked against the staff list — the
   * opposite default from completion, where the actor is whoever performed the
   * act. A task assigned to somebody who has left the firm is a task nobody is
   * doing, and it would sit in the list looking assigned.
   */
  it.effect("refuses an assignee with no staff record", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* TaskService;
        const refused = yield* Effect.flip(service.raise(onMatter));

        expect(refused._tag).toBe("NotFound");
      }),
      // Everyone but Sarah, who `onMatter` names.
      { staff: advocates.filter((advocate) => advocate.id !== sarah.id) },
    ),
  );

  it.effect("does not let a Receptionist raise work", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* TaskService;
        const refused = yield* Effect.flip(service.raise(onMatter));

        expect(refused._tag).toBe("NotPermitted");
      }),
      { as: asReceptionist },
    ),
  );

  it.effect("records the raising in the audit trail", () =>
    Effect.gen(function* () {
      const built = firm();

      yield* TestClock.setTime(TODAY).pipe(
        Effect.andThen(
          Effect.flatMap(TaskService, (service) => service.raise(onMatter)),
        ),
        Effect.provideService(CurrentUser, asAdvocate),
        Effect.provide(built.layer),
      );

      const recorded = yield* built.audit.recorded;
      expect(recorded.map((entry) => entry.action)).toContain("task.raised");
    }),
  );
});

// ── Completing and reopening ──────────────────────────────────────────────

describe("completing work", () => {
  it.effect("attributes it to whoever is signed in", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* TaskService;
        const done = yield* service.complete(overdueTask.id);

        expect(done.status).toBe("Done");
        expect(Option.getOrThrow(done.completed).by).toBe(
          asAdvocate.advocateId,
        );
        expect(Option.getOrThrow(done.completed).on).toStrictEqual(TODAY);
      }),
    ),
  );

  it.effect("refuses to complete it twice", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* TaskService;
        const refused = yield* Effect.flip(service.complete(doneTask.id));

        expect(refused._tag).toBe("AlreadyDone");
      }),
    ),
  );

  /**
   * A portal user cannot reach here — they hold neither `task:read` nor
   * `task:write` — so this asserts the permission stops them before the
   * staff-record check ever runs.
   */
  it.effect("does not let a portal user touch the firm's work list", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* TaskService;
        const refused = yield* Effect.flip(service.workList());

        expect(refused._tag).toBe("NotPermitted");
      }),
      { as: asWanjiku },
    ),
  );

  it.effect("reopens to in progress, not to not started", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* TaskService;
        const reopened = yield* service.reopen(doneTask.id);

        expect(reopened.status).toBe("In progress");
        expect(Option.isNone(reopened.completed)).toBe(true);
      }),
    ),
  );

  it.effect("refuses to reopen work that was never finished", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* TaskService;
        const refused = yield* Effect.flip(service.reopen(overdueTask.id));

        expect(refused._tag).toBe("NotDone");
      }),
    ),
  );

  /**
   * The domain discards the completion record when a task is reopened, so the
   * audit trail is the only place the reversal survives. Both halves are
   * recorded, which is what makes that trade affordable.
   */
  it.effect("leaves both halves of a reversal in the trail", () =>
    Effect.gen(function* () {
      const built = firm();

      yield* TestClock.setTime(TODAY).pipe(
        Effect.andThen(
          Effect.gen(function* () {
            const service = yield* TaskService;
            yield* service.complete(overdueTask.id);
            yield* service.reopen(overdueTask.id);
          }),
        ),
        Effect.provideService(CurrentUser, asAdvocate),
        Effect.provide(built.layer),
      );

      const recorded = yield* built.audit.recorded;
      const actions = recorded.map((entry) => entry.action);

      expect(actions).toContain("task.completed");
      expect(actions).toContain("task.reopened");
    }),
  );
});

describe("reassigning", () => {
  it.effect("hands work to somebody else, and records it as its own act", () =>
    Effect.gen(function* () {
      const built = firm();

      const moved = yield* TestClock.setTime(TODAY).pipe(
        Effect.andThen(
          Effect.flatMap(TaskService, (service) =>
            service.reassign(overdueTask.id, grace.id),
          ),
        ),
        Effect.provideService(CurrentUser, asAdvocate),
        Effect.provide(built.layer),
      );

      expect(moved.assignedTo).toBe(grace.id);

      const recorded = yield* built.audit.recorded;
      expect(recorded.map((entry) => entry.action)).toContain(
        "task.reassigned",
      );
    }),
  );

  /**
   * Reassigning finished work changes nothing about who did it, and would leave
   * a completion record naming one person under an assignment naming another.
   */
  it.effect("refuses to reassign work that is already done", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* TaskService;
        const refused = yield* Effect.flip(
          service.reassign(doneTask.id, grace.id),
        );

        expect(refused._tag).toBe("AlreadyDone");
      }),
    ),
  );
});

// ── The work list ─────────────────────────────────────────────────────────

describe("the work list", () => {
  /**
   * **The boundary the whole module turns on.**
   *
   * `dueToday` is due on the 19th and the clock says the 19th at nine in the
   * morning. It belongs in `dueSoon`, not in `overdue` — a comparison against
   * the moment of asking would put it in the wrong one, and an overdue list
   * with false entries in it is a list people stop reading.
   */
  it.effect("does not call today's work overdue", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* TaskService;
        const list = yield* service.workList();

        expect(list.overdue.map((entry) => entry.task.id)).toStrictEqual([
          overdueTask.id,
        ]);
        expect(list.dueSoon.map((entry) => entry.task.id)).toContain(
          dueToday.id,
        );
      }),
    ),
  );

  /**
   * Exhaustive and disjoint. `later` is derived by subtraction rather than by a
   * third predicate, so a task cannot fall out of all three because somebody
   * wrote `>` where they meant `>=`.
   */
  it.effect("puts every open task in exactly one list", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* TaskService;
        const list = yield* service.workList();

        const placed = [...list.overdue, ...list.dueSoon, ...list.later].map(
          (entry) => entry.task.id,
        );

        expect(placed).toHaveLength(list.openCount);
        expect(new Set(placed).size).toBe(placed.length);
      }),
    ),
  );

  it.effect("does not chase work that is done", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* TaskService;
        const list = yield* service.workList();

        const every = [...list.overdue, ...list.dueSoon, ...list.later];
        expect(every.map((entry) => entry.task.id)).not.toContain(doneTask.id);
        expect(list.openCount).toBe(3);
      }),
    ),
  );

  it.effect("resolves the matter and the person carrying it", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* TaskService;
        const list = yield* service.workList();
        const [first] = list.overdue;

        expect(Option.getOrThrow(first!.matter).number).toBe(
          filedMatter.number,
        );
        expect(first!.assigneeName).toBe(sarah.name);
      }),
    ),
  );

  /** Firm work has no matter, and the summary says so rather than inventing one. */
  it.effect("leaves firm work without a matter", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* TaskService;
        const list = yield* service.workList();

        const chore = [...list.overdue, ...list.dueSoon, ...list.later].find(
          (entry) => entry.task.id === firmChore.id,
        );

        expect(Option.isNone(chore!.matter)).toBe(true);
      }),
    ),
  );

  it.effect("sorts by urgency, then deadline", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* TaskService;
        const list = yield* service.workList();
        const soon = list.dueSoon.map((entry) => entry.task.priority);

        // Never a lower priority before a higher one.
        const rank = { High: 0, Medium: 1, Low: 2 } as const;
        for (let i = 1; i < soon.length; i += 1) {
          expect(rank[soon[i]!]).toBeGreaterThanOrEqual(rank[soon[i - 1]!]);
        }
      }),
    ),
  );

  it.effect("lets a Receptionist read it", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* TaskService;
        const list = yield* service.workList();

        expect(list.openCount).toBeGreaterThan(0);
      }),
      { as: asReceptionist },
    ),
  );
});

// ── Closing a matter ──────────────────────────────────────────────────────

/**
 * **The rule with the most consequence in this module, and it lives elsewhere.**
 *
 * `CaseService.transition` refuses to close a matter with open work on it,
 * because closing does not delete those tasks — it removes them from every list
 * a person looks at. "File the decree absolute", left open on a matter closed
 * last March, is work that will now never be done by anyone, and not because
 * anyone decided against it.
 */
describe("closing a matter over open work", () => {
  it.effect("is refused, and says how much is outstanding", () =>
    scenario(
      Effect.gen(function* () {
        const cases = yield* CaseService;
        const refused = yield* Effect.flip(
          cases.transition(filedMatter.id, "Closed"),
        );

        expect(refused._tag).toBe("HasOpenTasks");
        if (refused._tag === "HasOpenTasks") {
          // Two of the three open tasks are on this matter; the third is firm
          // work with no matter at all.
          expect(refused.open).toBe(2);
          expect(refused.reason).toContain("2 tasks still open");
        }
      }),
      { as: asPartner },
    ),
  );

  it.effect("permits it once the work is done", () =>
    scenario(
      Effect.gen(function* () {
        const tasksService = yield* TaskService;
        const cases = yield* CaseService;

        yield* tasksService.complete(overdueTask.id);
        yield* tasksService.complete(dueToday.id);

        const closed = yield* cases.transition(filedMatter.id, "Closed");
        expect(closed.status).toBe("Closed");
      }),
      { as: asPartner },
    ),
  );

  /**
   * Firm work is not on any matter, so it cannot hold one open. The task that
   * would otherwise block this is `firmChore`, and it does not.
   */
  /**
   * Firm work is on no matter, so it cannot hold one open.
   *
   * Seeded with `firmChore` and nothing else: the count is per-matter, and a
   * chore with no `case_id` is invisible to it. An implementation that counted
   * every open task would fail here, and would make it impossible to close any
   * matter while the trust reconciliation was outstanding.
   */
  it.effect("is not held up by firm work with no matter", () =>
    scenario(
      Effect.gen(function* () {
        const cases = yield* CaseService;
        const closed = yield* cases.transition(filedMatter.id, "Closed");

        expect(closed.status).toBe("Closed");
      }),
      { as: asPartner, seed: [firmChore] },
    ),
  );

  /** Only on the way *in* to Closed. Every other move passes untouched. */
  it.effect("does not obstruct any other transition", () =>
    scenario(
      Effect.gen(function* () {
        const cases = yield* CaseService;
        const moved = yield* cases.transition(filedMatter.id, "Under Review");

        expect(moved.status).toBe("Under Review");
      }),
      { as: asPartner },
    ),
  );

  /**
   * The refusal leaves the matter alone. A rule that failed *after* the write
   * would be worse than no rule, and the check runs before the transaction for
   * that reason.
   */
  it.effect("leaves the matter open when it refuses", () =>
    Effect.gen(function* () {
      const built = firm();

      yield* TestClock.setTime(TODAY).pipe(
        Effect.andThen(
          Effect.flatMap(CaseService, (service) =>
            Effect.flip(service.transition(filedMatter.id, "Closed")),
          ),
        ),
        Effect.provideService(CurrentUser, asPartner),
        Effect.provide(built.layer),
      );

      // The store the service actually wrote to, not a fresh one.
      const after = yield* Ref.get(built.cases.store);
      expect(
        after.find((matter) => matter.id === filedMatter.id)?.status,
      ).not.toBe("Closed");
    }),
  );

  it.effect("lets a Finance Officer raise the chore they have to do", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* TaskService;
        const raised = yield* service.raise({
          title: "Reconcile the trust account",
          caseId: Option.none(),
          assignedTo: grace.id,
          priority: "Medium",
          dueOn: new Date("2026-08-31T00:00:00.000Z"),
        });

        expect(raised.title).toBe("Reconcile the trust account");
      }),
      { as: asFinance },
    ),
  );
});
