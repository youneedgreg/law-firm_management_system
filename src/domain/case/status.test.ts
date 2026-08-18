import { Either, Option } from "effect";
import { describe, expect, it } from "vitest";
import * as Status from "./status";

describe("transition", () => {
  it("moves a new matter into active work", () => {
    expect(Either.getOrThrow(Status.transition("New", "Active"))).toBe(
      "Active",
    );
  });

  it("refuses to reopen a closed matter as active", () => {
    // Closed may be appealed, but never silently revived — that would erase
    // the fact that the matter ever closed.
    const result = Status.transition("Closed", "Active");
    expect(Either.isLeft(result)).toBe(true);
  });

  it("allows a closed matter to be appealed", () => {
    expect(Either.isRight(Status.transition("Closed", "Appealed"))).toBe(true);
  });

  it("refuses to send a reserved judgment back to active", () => {
    const result = Status.transition("Judgment Pending", "Active");
    expect(Either.isLeft(result)).toBe(true);
  });

  it("refuses to skip straight from new to judgment", () => {
    expect(Either.isLeft(Status.transition("New", "Judgment Pending"))).toBe(
      true,
    );
  });

  it("refuses a no-op restatement of the current status", () => {
    // Almost always a double submit or a stale form. Accepting it writes a
    // history entry recording that nothing happened.
    for (const status of Status.CASE_STATUSES) {
      expect(Either.isLeft(Status.transition(status, status))).toBe(true);
    }
  });

  it("explains a refusal with the moves that were available", () => {
    const result = Status.transition("Closed", "New");
    const error = Option.getOrThrow(Either.getLeft(result));

    expect(error.from).toBe("Closed");
    expect(error.to).toBe("New");
    expect(error.reason).toContain("Appealed");
  });
});

describe("the transition table itself", () => {
  it("covers every status", () => {
    for (const status of Status.CASE_STATUSES) {
      expect(Status.TRANSITIONS[status]).toBeDefined();
    }
  });

  it("only ever points at real statuses", () => {
    for (const status of Status.CASE_STATUSES) {
      for (const target of Status.TRANSITIONS[status]) {
        expect(Status.CASE_STATUSES).toContain(target);
      }
    }
  });

  it("never lets a status transition to itself", () => {
    for (const status of Status.CASE_STATUSES) {
      expect(Status.TRANSITIONS[status]).not.toContain(status);
    }
  });

  it("leaves every status reachable from New", () => {
    // A status nothing can reach is dead weight in the union, and a sign the
    // table and the list have drifted apart.
    const reached = new Set<Status.CaseStatus>(["New"]);
    const queue: Status.CaseStatus[] = ["New"];

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const next of Status.TRANSITIONS[current]) {
        if (!reached.has(next)) {
          reached.add(next);
          queue.push(next);
        }
      }
    }

    expect([...reached].sort()).toStrictEqual([...Status.CASE_STATUSES].sort());
  });
});

describe("isOpen", () => {
  it("counts an appealed matter as still open", () => {
    expect(Status.isOpen("Appealed")).toBe(true);
  });

  it("counts only closed as finished", () => {
    const open = Status.CASE_STATUSES.filter(Status.isOpen);
    expect(open).not.toContain("Closed");
    expect(open).toHaveLength(Status.CASE_STATUSES.length - 1);
  });
});
