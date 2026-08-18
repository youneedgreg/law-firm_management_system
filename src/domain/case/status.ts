import { Either, Schema } from "effect";

/**
 * The lifecycle of a matter, as a state machine.
 *
 * A status field that accepts any value from the list lets a closed matter
 * jump back to "New", or a matter reach "Judgment Pending" without ever having
 * been active. Neither is a thing that happens in a practice, and both are
 * indistinguishable from a real update once the row is written.
 *
 * So the legal moves are declared once, in `TRANSITIONS`, and the only way to
 * change a status is `transition`, which returns `Either`. Callers cannot
 * forget to check: the value they need is inside the `Right`.
 */

export const CASE_STATUSES = [
  "New",
  "Active",
  "Hearing Scheduled",
  "Under Review",
  "Judgment Pending",
  "Closed",
  "Appealed",
] as const;

export const CaseStatus = Schema.Literal(...CASE_STATUSES);
export type CaseStatus = typeof CaseStatus.Type;

/**
 * Which statuses each status may move to.
 *
 * Reading the interesting ones aloud:
 *
 * - **New** either becomes active or is closed — a matter opened and then
 *   declined at intake never reaches a court.
 * - **Judgment Pending** cannot go back to active. Once judgment is reserved
 *   the matter is out of the advocate's hands; it ends, or it is appealed.
 * - **Closed** may still be appealed, because the appeal window outlives the
 *   judgment. It may not silently reopen — reviving a closed matter as active
 *   would erase the fact that it ever closed.
 * - **Appealed** returns to active while the appeal is heard.
 */
export const TRANSITIONS: Readonly<Record<CaseStatus, readonly CaseStatus[]>> =
  {
    New: ["Active", "Closed"],
    Active: ["Hearing Scheduled", "Under Review", "Judgment Pending", "Closed"],
    "Hearing Scheduled": [
      "Active",
      "Under Review",
      "Judgment Pending",
      "Closed",
    ],
    "Under Review": [
      "Active",
      "Hearing Scheduled",
      "Judgment Pending",
      "Closed",
    ],
    "Judgment Pending": ["Closed", "Appealed"],
    Closed: ["Appealed"],
    Appealed: ["Active", "Closed"],
  };

export class InvalidTransition extends Schema.TaggedError<InvalidTransition>()(
  "InvalidTransition",
  { from: CaseStatus, to: CaseStatus },
) {
  get reason(): string {
    const allowed = TRANSITIONS[this.from];
    return allowed.length === 0
      ? `A matter that is ${this.from} cannot change status`
      : `A matter that is ${this.from} cannot become ${this.to}; ` +
          `it may only become ${allowed.join(", ")}`;
  }
}

/** Whether a move is legal, without performing it. */
export const canTransition = (from: CaseStatus, to: CaseStatus): boolean =>
  TRANSITIONS[from].includes(to);

/**
 * Moves a matter to a new status, or explains why it cannot.
 *
 * Re-declaring the current status is refused rather than treated as a no-op.
 * It is almost always a double submit or a stale form, and silently accepting
 * it writes a history entry saying nothing happened.
 */
export const transition = (
  from: CaseStatus,
  to: CaseStatus,
): Either.Either<CaseStatus, InvalidTransition> =>
  canTransition(from, to)
    ? Either.right(to)
    : Either.left(new InvalidTransition({ from, to }));

/** Statuses a matter in this state may move to. */
export const allowedFrom = (status: CaseStatus): readonly CaseStatus[] =>
  TRANSITIONS[status];

/**
 * Whether the firm is still doing work on this matter.
 *
 * Closed is the only resting state; appealed matters are live again. Used for
 * the "active cases" figures on the dashboard, so it is worth being explicit
 * that an appealed matter counts.
 */
export const isOpen = (status: CaseStatus): boolean => status !== "Closed";
