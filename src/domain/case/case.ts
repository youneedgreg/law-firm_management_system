import { Either, Schema } from "effect";
import { AdvocateId, CaseId, CaseNumber, ClientId } from "../shared/ids";
import * as Money from "../shared/money";
import * as Court from "../court/court";
import * as Limitation from "./limitation";
import * as Status from "./status";

/**
 * A matter — the thing the whole system is arranged around.
 *
 * This is where the earlier modules meet: the court comes from `court/`, the
 * status from `status.ts`, the limitation basis from `limitation.ts`, and the
 * claim value is `Money`. None of them were built for this file; they compose
 * because each one models a rule rather than a screen.
 *
 * Two fields exist that a naive schema would collapse into one string:
 *
 * - `number` is the firm's own reference (`OKL-2026-014`), assigned at intake.
 * - `causeNumber` is the court's, assigned on filing, and absent until then.
 *
 * Conflating them means an unfiled matter has to borrow a number it does not
 * have, and a matter transferred between courts loses its history.
 */

export const MATTER_TYPES = [
  "Civil",
  "Criminal",
  "Family",
  "Probate",
  "Labour",
  "Land",
  "Commercial",
  "Tax",
  "Constitutional",
  "Arbitration",
] as const;

export const MatterType = Schema.Literal(...MATTER_TYPES);
export type MatterType = typeof MatterType.Type;

export const Case = Schema.Struct({
  id: CaseId,
  /** The firm's reference, assigned at intake. */
  number: CaseNumber,
  /** The court's reference, assigned on filing. Absent before then. */
  causeNumber: Schema.optional(Schema.NonEmptyTrimmedString),
  title: Schema.NonEmptyTrimmedString,
  type: MatterType,
  status: Status.CaseStatus,
  clientId: ClientId,
  advocateId: AdvocateId,
  court: Schema.optional(Court.Court),
  /**
   * What the matter is worth, where that is known. Absent for matters with no
   * pecuniary value — a criminal defence, or a declaratory application — which
   * is a different thing from a claim worth nothing.
   */
  claimValueCents: Schema.optional(Schema.Int.pipe(Schema.nonNegative())),
  /** Claims under customary law escape the pecuniary limit (s. 7(3)). */
  underCustomaryLaw: Schema.Boolean,
  /** When the cause of action accrued, for the limitation clock. */
  accruedOn: Schema.optional(Schema.DateFromSelf),
  limitationBasis: Schema.optional(Limitation.LimitationBasis),
  openedOn: Schema.DateFromSelf,
  filedOn: Schema.optional(Schema.DateFromSelf),
});

export type Case = typeof Case.Type;

// ── Derived views ─────────────────────────────────────────────────────────

export const claimValue = (matter: Case): Money.Money | undefined =>
  matter.claimValueCents === undefined
    ? undefined
    : Money.fromCents(matter.claimValueCents);

export const isOpen = (matter: Case): boolean => Status.isOpen(matter.status);

/** Whether the matter has been filed in court. */
export const isFiled = (matter: Case): boolean => matter.filedOn !== undefined;

/**
 * The limitation window, where enough is known to compute one.
 *
 * Returns `undefined` rather than guessing a basis: a matter with no recorded
 * accrual date has no limitation date, and inventing one from the intake date
 * would put a confident wrong figure in front of an advocate.
 */
export const limitation = (
  matter: Case,
): Limitation.LimitationWindow | undefined =>
  matter.accruedOn === undefined || matter.limitationBasis === undefined
    ? undefined
    : Limitation.limitationWindow(matter.limitationBasis, matter.accruedOn);

// ── Filing ────────────────────────────────────────────────────────────────

export class CannotFileWithoutValue extends Schema.TaggedError<CannotFileWithoutValue>()(
  "CannotFileWithoutValue",
  { caseNumber: Schema.String },
) {
  get reason(): string {
    return (
      `Matter ${this.caseNumber} has no claim value, so its court's pecuniary ` +
      `jurisdiction cannot be checked. Record a value, or file in a court with ` +
      `unlimited pecuniary jurisdiction`
    );
  }
}

/**
 * Checks that a matter may be filed in a given court.
 *
 * Delegates the actual rule to `Court.canHear` rather than restating it: the
 * pecuniary limits belong to the court module, and a second copy here would be
 * the one that goes stale when the Chief Justice gazettes new figures.
 *
 * A magistrates' court with no claim value recorded is refused rather than
 * waved through. "We don't know what it's worth" is not evidence that it is
 * within the limit, and quietly assuming so is how a matter gets filed in the
 * wrong court.
 */
export const canFileIn = (
  matter: Case,
  court: Court.Court,
): Either.Either<
  Court.Court,
  Court.OutsideCourtJurisdiction | CannotFileWithoutValue
> => {
  if (court._tag !== "MagistratesCourt") return Either.right(court);
  if (matter.underCustomaryLaw) return Either.right(court);

  const value = claimValue(matter);
  if (value === undefined) {
    return Either.left(
      new CannotFileWithoutValue({ caseNumber: matter.number }),
    );
  }

  return Court.canHear(court, {
    value,
    underCustomaryLaw: matter.underCustomaryLaw,
  });
};

/** Moves the matter to a new status, or explains why it cannot. */
export const changeStatus = (
  matter: Case,
  to: Status.CaseStatus,
): Either.Either<Case, Status.InvalidTransition> =>
  Either.map(Status.transition(matter.status, to), (status) => ({
    ...matter,
    status,
  }));

// ── Consistency ───────────────────────────────────────────────────────────

export class FilingPrecedesIntake extends Schema.TaggedError<FilingPrecedesIntake>()(
  "FilingPrecedesIntake",
  { openedOn: Schema.DateFromSelf, filedOn: Schema.DateFromSelf },
) {
  get reason(): string {
    const day = (date: Date) => date.toISOString().slice(0, 10);
    return (
      `The matter was filed on ${day(this.filedOn)} but opened on ` +
      `${day(this.openedOn)}. A file is opened before it is filed`
    );
  }
}

export class CauseNumberWithoutFiling extends Schema.TaggedError<CauseNumberWithoutFiling>()(
  "CauseNumberWithoutFiling",
  { causeNumber: Schema.String },
) {
  get reason(): string {
    return (
      `Cause number ${this.causeNumber} was recorded against a matter with no ` +
      `filing date. The court assigns it on filing, so one without the other ` +
      `is a record of something that did not happen`
    );
  }
}

export class IncompleteLimitation extends Schema.TaggedError<IncompleteLimitation>()(
  "IncompleteLimitation",
  { has: Schema.Literal("accrual date", "basis") },
) {
  get reason(): string {
    const missing = this.has === "accrual date" ? "basis" : "accrual date";
    return (
      `The limitation clock needs both an accrual date and a basis; this ` +
      `matter has only the ${this.has}. Record the ${missing}, or remove the ` +
      `${this.has} — one alone computes nothing and invites a later guess at ` +
      `the other`
    );
  }
}

export type Inconsistency =
  FilingPrecedesIntake | CauseNumberWithoutFiling | IncompleteLimitation;

/**
 * The rules relating a matter's fields to each other.
 *
 * The schema can say a filing date is a date; it cannot say the date is not
 * before the intake date, because that compares two fields. Those checks live
 * here rather than in the persistence layer so they are enforced on a `Case`
 * that never reaches a database — and so the reason an advocate reads is a
 * sentence rather than the name of a Postgres constraint.
 *
 * Both mirror a constraint in the schema on purpose. The database is the
 * backstop for whatever bypasses this code; this is what stops anything
 * bypassing it from being the *normal* path.
 *
 * **A filed matter with no court is deliberately allowed.** `Court` models the
 * Article 162 hierarchy, and matters are genuinely filed outside it — the Tax
 * Appeals Tribunal is constituted under its own Act. Refusing that would force
 * a tribunal matter to name a court it was never filed in, which is the kind of
 * invented fact this whole layer exists to prevent.
 */
export const consistency = (
  matter: Case,
): Either.Either<Case, Inconsistency> => {
  if (
    matter.filedOn !== undefined &&
    matter.filedOn.getTime() < matter.openedOn.getTime()
  ) {
    return Either.left(
      new FilingPrecedesIntake({
        openedOn: matter.openedOn,
        filedOn: matter.filedOn,
      }),
    );
  }

  if (matter.causeNumber !== undefined && matter.filedOn === undefined) {
    return Either.left(
      new CauseNumberWithoutFiling({ causeNumber: matter.causeNumber }),
    );
  }

  if (
    (matter.accruedOn === undefined) !==
    (matter.limitationBasis === undefined)
  ) {
    return Either.left(
      new IncompleteLimitation({
        has: matter.accruedOn === undefined ? "basis" : "accrual date",
      }),
    );
  }

  return Either.right(matter);
};
