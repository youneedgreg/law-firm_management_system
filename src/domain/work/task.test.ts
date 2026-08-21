import { describe, expect, it } from "vitest";
import { Either, Option, Schema } from "effect";
import { AdvocateId, CaseId, TaskId } from "../shared/ids";
import {
  byUrgency,
  complete,
  dueWithin,
  isOpen,
  overdue,
  raise,
  reopen,
  Task,
} from "./task";

/**
 * Tasks, and the two questions a task list has to answer correctly.
 *
 * "What is overdue" and "what is due soon" look like filters and are not: both
 * turn on where a *day* ends, and both are wrong in a way nobody notices if the
 * comparison is against the moment of asking. A task due today reported as
 * overdue at nine in the morning trains people to ignore the overdue list,
 * which is the only list that matters.
 */

const taskId = (n: number) =>
  Schema.decodeSync(TaskId)(`c0000000-0000-4000-8000-00000000000${n}`);

const advocate = Schema.decodeSync(AdvocateId)(
  "10000000-0000-4000-8000-000000000001",
);

const matter = Schema.decodeSync(CaseId)(
  "20000000-0000-4000-8000-000000000001",
);

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const decode = Schema.decodeSync(Schema.typeSchema(Task));

const task = (fields: Partial<typeof Task.Type> = {}): typeof Task.Type =>
  decode({
    id: taskId(1),
    title: "Draft affidavit",
    caseId: Option.some(matter),
    assignedTo: advocate,
    priority: "High",
    status: "Not started",
    raisedOn: day("2026-08-10"),
    dueOn: day("2026-08-20"),
    completed: Option.none(),
    ...fields,
  });

describe("raising", () => {
  it("starts a task not started, and not complete", () => {
    const raised = raise({
      id: taskId(1),
      title: "File at the registry",
      caseId: Option.some(matter),
      assignedTo: advocate,
      priority: "Medium",
      raisedOn: day("2026-08-10"),
      dueOn: day("2026-08-14"),
    });

    expect(Either.isRight(raised)).toBe(true);
    if (Either.isRight(raised)) {
      expect(raised.right.status).toBe("Not started");
      expect(Option.isNone(raised.right.completed)).toBe(true);
    }
  });

  /**
   * A due date behind the raising date is nearly always a mistyped year, and
   * the task would appear as overdue the moment it was saved — noise in the one
   * list that has to have none.
   */
  it("refuses a task due before it was raised", () => {
    const raised = raise({
      id: taskId(1),
      title: "File at the registry",
      caseId: Option.none(),
      assignedTo: advocate,
      priority: "Medium",
      raisedOn: day("2026-08-10"),
      dueOn: day("2025-08-14"),
    });

    expect(Either.isLeft(raised)).toBe(true);
    if (Either.isLeft(raised)) {
      expect(raised.left.reason).toContain("mistyped year");
    }
  });

  /** Due today is legitimate, and is the boundary the check has to allow. */
  it("allows a task raised and due on the same day", () => {
    const raised = raise({
      id: taskId(1),
      title: "Serve the pleadings",
      caseId: Option.none(),
      assignedTo: advocate,
      priority: "High",
      // Raised mid-morning; due "today", which is midnight.
      raisedOn: new Date("2026-08-10T09:30:00.000Z"),
      dueOn: day("2026-08-10"),
    });

    expect(Either.isRight(raised)).toBe(true);
  });

  it("lets firm work exist with no matter behind it", () => {
    const raised = raise({
      id: taskId(1),
      title: "Reconcile the trust account",
      caseId: Option.none(),
      assignedTo: advocate,
      priority: "Medium",
      raisedOn: day("2026-08-10"),
      dueOn: day("2026-08-25"),
    });

    expect(Either.isRight(raised)).toBe(true);
  });
});

describe("completion", () => {
  it("records who and when", () => {
    const done = complete(task(), advocate, day("2026-08-18"));

    expect(Either.isRight(done)).toBe(true);
    if (Either.isRight(done)) {
      expect(done.right.status).toBe("Done");
      expect(Option.getOrThrow(done.right.completed).by).toBe(advocate);
      expect(Option.getOrThrow(done.right.completed).on).toStrictEqual(
        day("2026-08-18"),
      );
      expect(isOpen(done.right)).toBe(false);
    }
  });

  it("refuses to complete a task twice, and says when it was done", () => {
    const done = Either.getOrThrow(
      complete(task(), advocate, day("2026-08-18")),
    );
    const again = complete(done, advocate, day("2026-08-19"));

    expect(Either.isLeft(again)).toBe(true);
    if (Either.isLeft(again)) {
      expect(again.left.completedOn).toStrictEqual(day("2026-08-18"));
      expect(again.left.reason).toContain("2026-08-18");
    }
  });

  /**
   * Reopening returns work to `In progress`, not `Not started`.
   *
   * Somebody thought it was finished, so it is not true that nothing has been
   * done. The completion record is discarded — a task is a note to ourselves
   * about work rather than evidence about the world, and the audit trail
   * carries both entries if the reversal ever has to be proved.
   */
  it("reopens to in progress and discards the completion", () => {
    const done = Either.getOrThrow(
      complete(task(), advocate, day("2026-08-18")),
    );
    const reopened = reopen(done);

    expect(Either.isRight(reopened)).toBe(true);
    if (Either.isRight(reopened)) {
      expect(reopened.right.status).toBe("In progress");
      expect(Option.isNone(reopened.right.completed)).toBe(true);
    }
  });

  it("refuses to reopen work that was never finished", () => {
    expect(Either.isLeft(reopen(task()))).toBe(true);
  });

  /**
   * The schema invariant, in both directions.
   *
   * A boolean beside two nullable columns is three facts that can disagree, and
   * this is what stops them. Postgres says the same thing in `done_iff_completed`.
   */
  it("cannot represent Done with nothing recorded", () => {
    expect(() =>
      decode({ ...task(), status: "Done", completed: Option.none() }),
    ).toThrow();
  });

  it("cannot represent a completion record under any other status", () => {
    expect(() =>
      decode({
        ...task(),
        status: "In progress",
        completed: Option.some({ on: day("2026-08-18"), by: advocate }),
      }),
    ).toThrow();
  });
});

describe("what is overdue", () => {
  const asAt = new Date("2026-08-20T09:00:00.000Z");

  /**
   * **The test this module exists for.**
   *
   * Nine in the morning on the day a task is due. A comparison against the
   * moment of asking reports it as overdue; a comparison against the start of
   * the day does not. Due dates are days, and the second answer is the right
   * one — the first trains people to ignore the overdue list.
   */
  it("does not call a task due today overdue", () => {
    const dueToday = task({ dueOn: day("2026-08-20") });

    expect(overdue([dueToday], asAt)).toStrictEqual([]);
  });

  it("calls yesterday's task overdue", () => {
    const late = task({ dueOn: day("2026-08-19") });

    expect(overdue([late], asAt)).toHaveLength(1);
  });

  it("does not chase work that is already done", () => {
    const late = task({ dueOn: day("2026-08-01") });
    const done = Either.getOrThrow(complete(late, advocate, day("2026-08-02")));

    expect(overdue([done], asAt)).toStrictEqual([]);
  });
});

describe("what is due soon", () => {
  const asAt = new Date("2026-08-20T16:00:00.000Z");

  it("includes today, even late in the day", () => {
    expect(
      dueWithin([task({ dueOn: day("2026-08-20") })], asAt, 7),
    ).toHaveLength(1);
  });

  it("includes the last day of the window and excludes the next", () => {
    const inside = task({ dueOn: day("2026-08-27") });
    const outside = task({ id: taskId(2), dueOn: day("2026-08-28") });

    expect(dueWithin([inside, outside], asAt, 7)).toStrictEqual([inside]);
  });

  /**
   * Overdue work is excluded, because it has its own list. A task in both would
   * be counted twice by anything summing them — which the dashboard does.
   */
  it("does not also report overdue work", () => {
    const late = task({ dueOn: day("2026-08-01") });

    expect(dueWithin([late], asAt, 7)).toStrictEqual([]);
    expect(overdue([late], asAt)).toHaveLength(1);
  });
});

describe("ordering", () => {
  it("puts urgency before deadline", () => {
    const soonButLow = task({
      id: taskId(1),
      title: "Low, due tomorrow",
      priority: "Low",
      dueOn: day("2026-08-21"),
    });
    const laterButHigh = task({
      id: taskId(2),
      title: "High, due next week",
      priority: "High",
      dueOn: day("2026-08-28"),
    });

    expect(byUrgency([soonButLow, laterButHigh])).toStrictEqual([
      laterButHigh,
      soonButLow,
    ]);
  });

  it("breaks a tie on priority with the deadline", () => {
    const sooner = task({ id: taskId(1), dueOn: day("2026-08-21") });
    const later = task({ id: taskId(2), dueOn: day("2026-08-28") });

    expect(byUrgency([later, sooner])).toStrictEqual([sooner, later]);
  });

  it("does not mutate what it is given", () => {
    const first = task({ id: taskId(1), priority: "Low" });
    const second = task({ id: taskId(2), priority: "High" });
    const given = [first, second];

    byUrgency(given);

    expect(given).toStrictEqual([first, second]);
  });
});
