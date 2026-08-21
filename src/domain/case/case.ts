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
  /**
   * Who the client is against.
   *
   * Added in Phase 7, and the gap it closes is worth naming because it was
   * invisible until something needed it. `title` is free text — "Wanjiku Mwangi
   * v. Nairobi Metro SACCO" — and a title is what a screen prints, not
   * something that can be searched. `domain/client/conflicts.ts` was written in
   * Phase 1 against a `MatterRecord` carrying structured parties, and **nothing
   * produced one**: the conflict screen could be tested and could not be run.
   *
   * A `readonly string[]` rather than a table of parties, and that is a
   * deliberate stopping point. The screen matches on *names*, normalised — it
   * never needs a party's own record, and modelling one would mean deciding
   * what an opposing party is when they are also a client, which is the
   * question the screen exists to raise rather than to answer.
   *
   * Empty is legitimate and common: a conveyance, a probate application, an
   * advisory retainer. It is not a missing value, so this is an array rather
   * than an optional one.
   */
  opposingParties: Schema.Array(Schema.NonEmptyTrimmedString),
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

/**
 * The two dates are `Schema.Date` rather than `Schema.DateFromSelf`, which is
 * the only place in this module that distinction is visible.
 *
 * Both carry a `Date` on the type side, so nothing that constructs or reads
 * this error changes. They differ on the *encoded* side: `DateFromSelf` encodes
 * to a `Date`, which is not JSON, and an error that cannot be serialised is an
 * error that cannot leave the process. This one has to — it is returned by the
 * API in Phase 4, decoded back into this class by the generated client, and the
 * `reason` below is what the client then renders.
 *
 * The rest of the module keeps `DateFromSelf` deliberately: `Case` is encoded
 * by the SQL layer into columns, not into JSON, and `columns.ts` owns that
 * conversion because a date column and an ISO timestamp are not the same thing.
 */
export class FilingPrecedesIntake extends Schema.TaggedError<FilingPrecedesIntake>()(
  "FilingPrecedesIntake",
  { openedOn: Schema.Date, filedOn: Schema.Date },
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

/**
 * A closed matter, asked to do something only an open one can.
 *
 * **One error, in the domain, rather than one per service.** It was declared
 * twice — once in `time-service.ts` and once in `task-service.ts` — with the
 * same tag and the same field, which the API's own error table caught: two
 * schemas cannot both be `MatterIsClosed` on one wire, and a client branching
 * on `_tag` could not have told them apart if they had.
 *
 * That is a real defect and not merely tidiness. Errors on this API are part
 * of the contract; a tag that means two things is a tag that means nothing.
 *
 * `attempted` is what keeps the message specific while the tag stays single.
 * It is a short verb phrase completing "…so you cannot ___", supplied by the
 * caller because only the caller knows what was being tried.
 */
export class MatterIsClosed extends Schema.TaggedError<MatterIsClosed>()(
  "MatterIsClosed",
  { number: Schema.String, attempted: Schema.String },
) {
  get reason(): string {
    return (
      `${this.number} is closed, so you cannot ${this.attempted}. Reopen the ` +
      `matter first if the work is real — that is a decision with its own ` +
      `audit entry rather than a side effect of another screen`
    );
  }
}

/**
 * A matter named against the wrong client.
 *
 * In the domain, beside `MatterIsClosed`, and for the same reason: it was about
 * to be declared a second time — once in `message-service.ts` and once in
 * `library-service.ts` — and two tagged errors sharing a tag is a tag that
 * means nothing on the wire. That lesson was learned once already in Phase 7;
 * this is it being applied before the collision rather than after.
 *
 * It is deliberately **not** a `NotFound`. Scope violations answer `NotFound`
 * because confirming a record exists is itself a disclosure; here the sender
 * can see both the client and the matter and has simply put them together
 * wrongly, and "not found" for something plainly on screen is baffling rather
 * than discreet.
 */
export class MatterIsNotTheirs extends Schema.TaggedError<MatterIsNotTheirs>()(
  "MatterIsNotTheirs",
  { number: Schema.String },
) {
  get reason(): string {
    return (
      `${this.number} is not this client's matter, so it cannot be filed ` +
      `against their record`
    );
  }
}
