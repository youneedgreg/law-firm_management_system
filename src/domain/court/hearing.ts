import { Either, Schema } from "effect";
import { AdvocateId, CaseId, HearingId } from "../shared/ids";
import * as Court from "./court";

/**
 * Court dates.
 *
 * The whole reason a firm needs this system: a missed hearing can mean a matter
 * dismissed for want of prosecution. So the model is arranged around not losing
 * one, and in particular around adjournments, which are how court dates
 * actually get lost — a hearing is adjourned, everyone remembers it happened,
 * and nobody records where it went.
 */

export const HEARING_KINDS = [
  "Mention",
  "Hearing",
  "Ruling",
  "Judgment",
  "Directions",
  "Application",
] as const;

export const HearingKind = Schema.Literal(...HEARING_KINDS);
export type HearingKind = typeof HearingKind.Type;

/**
 * How a hearing ended.
 *
 * `Adjourned` carries the date it went to, so an adjournment cannot be recorded
 * without saying where the matter is now listed. That is the single most
 * useful constraint in this module: an adjournment with no next date is a
 * matter quietly falling off the diary.
 */
export const Outcome = Schema.Union(
  Schema.TaggedStruct("Heard", { note: Schema.optional(Schema.String) }),
  Schema.TaggedStruct("Adjourned", {
    adjournedTo: Schema.DateFromSelf,
    reason: Schema.NonEmptyTrimmedString,
  }),
  Schema.TaggedStruct("NotReached", { note: Schema.optional(Schema.String) }),
  Schema.TaggedStruct("Withdrawn", { note: Schema.optional(Schema.String) }),
);

export type Outcome = typeof Outcome.Type;

export const Hearing = Schema.Struct({
  id: HearingId,
  caseId: CaseId,
  kind: HearingKind,
  court: Court.Court,
  /** Courtroom or registry, where known. */
  room: Schema.optional(Schema.NonEmptyTrimmedString),
  scheduledFor: Schema.DateFromSelf,
  advocateId: AdvocateId,
  /** Absent until the date has happened and someone has recorded it. */
  outcome: Schema.optional(Outcome),
});

export type Hearing = typeof Hearing.Type;

export const isRecorded = (hearing: Hearing): boolean =>
  hearing.outcome !== undefined;

/**
 * Hearings whose date has passed with no outcome recorded.
 *
 * The report that matters. An unrecorded past hearing is either an
 * administrative gap or a missed attendance, and the firm needs to know which
 * before the other side raises it.
 */
export const awaitingOutcome = (
  hearings: readonly Hearing[],
  asAt: Date,
): readonly Hearing[] =>
  hearings.filter(
    (hearing) =>
      !isRecorded(hearing) && hearing.scheduledFor.getTime() < asAt.getTime(),
  );

/** Upcoming hearings, soonest first. */
export const upcoming = (
  hearings: readonly Hearing[],
  asAt: Date,
): readonly Hearing[] =>
  [...hearings]
    .filter(
      (hearing) =>
        !isRecorded(hearing) &&
        hearing.scheduledFor.getTime() >= asAt.getTime(),
    )
    .sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime());

export class AdjournedIntoThePast extends Schema.TaggedError<AdjournedIntoThePast>()(
  "AdjournedIntoThePast",
  { scheduledFor: Schema.DateFromSelf, adjournedTo: Schema.DateFromSelf },
) {
  get reason(): string {
    return (
      `A hearing on ${this.scheduledFor.toDateString()} cannot be adjourned to ` +
      `${this.adjournedTo.toDateString()}, which is earlier. Check the new date`
    );
  }
}

/**
 * Records how a hearing went.
 *
 * An adjournment to a date at or before the hearing itself is refused — always
 * a typo, usually a year entered wrong, and it would place the matter in the
 * past where no diary view will surface it again.
 */
export const recordOutcome = (
  hearing: Hearing,
  outcome: Outcome,
): Either.Either<Hearing, AdjournedIntoThePast> => {
  if (
    outcome._tag === "Adjourned" &&
    outcome.adjournedTo.getTime() <= hearing.scheduledFor.getTime()
  ) {
    return Either.left(
      new AdjournedIntoThePast({
        scheduledFor: hearing.scheduledFor,
        adjournedTo: outcome.adjournedTo,
      }),
    );
  }

  return Either.right({ ...hearing, outcome });
};

/** The date an adjournment sent the matter to, if it was adjourned. */
export const adjournedTo = (hearing: Hearing): Date | undefined =>
  hearing.outcome?._tag === "Adjourned"
    ? hearing.outcome.adjournedTo
    : undefined;
