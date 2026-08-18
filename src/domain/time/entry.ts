import { Either, Schema } from "effect";
import { AdvocateId, CaseId } from "../shared/ids";
import * as Money from "../shared/money";

/**
 * Recorded time, which is where a firm's revenue actually comes from.
 *
 * Two rules do most of the work here:
 *
 * **Duration is stored, not the pair of clock times.** A time entry is
 * fundamentally "ninety minutes on this matter"; when it happened matters for
 * the diary, but billing only ever needs the length. Storing both and deriving
 * neither is how the two end up disagreeing after someone edits a start time.
 *
 * **Non-billable time is still recorded.** Write-offs, pro bono, and internal
 * work are all real and all need to appear in utilisation figures. A model that
 * only records billable time cannot answer where the week went.
 */

export const ACTIVITIES = [
  "Research",
  "Drafting",
  "Court attendance",
  "Consultation",
  "Correspondence",
  "Travel",
  "Administration",
] as const;

export const Activity = Schema.Literal(...ACTIVITIES);
export type Activity = typeof Activity.Type;

export const TimeEntry = Schema.Struct({
  caseId: CaseId,
  advocateId: AdvocateId,
  activity: Activity,
  /** Minutes worked. Whole minutes — nobody bills in seconds. */
  minutes: Schema.Int.pipe(Schema.positive()),
  workedOn: Schema.DateFromSelf,
  billable: Schema.Boolean,
  /** The advocate's rate for this work, in cents per hour. */
  hourlyRateCents: Schema.Int.pipe(Schema.nonNegative()),
  narrative: Schema.NonEmptyTrimmedString,
  /** Set once the entry has been carried onto a fee note. */
  invoiced: Schema.Boolean,
});

export type TimeEntry = typeof TimeEntry.Type;

/**
 * What this entry is worth.
 *
 * Non-billable time is worth nothing by definition, so this returns zero rather
 * than the rate — the alternative is every caller remembering to check
 * `billable` first, and one forgetting.
 */
export const value = (entry: TimeEntry): Money.Money =>
  entry.billable
    ? Money.multiply(Money.fromCents(entry.hourlyRateCents), entry.minutes / 60)
    : Money.zero;

/** Hours, to two decimal places, for display. */
export const hours = (entry: TimeEntry): number =>
  Math.round((entry.minutes / 60) * 100) / 100;

export const billableValue = (entries: readonly TimeEntry[]): Money.Money =>
  Money.sum(entries.map(value));

export const totalMinutes = (entries: readonly TimeEntry[]): number =>
  entries.reduce((sum, entry) => sum + entry.minutes, 0);

/**
 * The share of recorded time that is billable, between 0 and 1.
 *
 * Returns 0 for an empty list rather than dividing by zero. A firm that
 * recorded no time has a utilisation of nothing, not of NaN, and NaN reaching a
 * dashboard renders as a blank tile nobody can explain.
 */
export const utilisation = (entries: readonly TimeEntry[]): number => {
  const total = totalMinutes(entries);
  if (total === 0) return 0;
  const billable = totalMinutes(entries.filter((entry) => entry.billable));
  return billable / total;
};

export class AlreadyInvoiced extends Schema.TaggedError<AlreadyInvoiced>()(
  "AlreadyInvoiced",
  { narrative: Schema.String },
) {
  get reason(): string {
    return `"${this.narrative}" has already been carried onto a fee note; billing it again would double-charge the client`;
  }
}

/**
 * Marks an entry as invoiced, refusing one that already is.
 *
 * The failure this prevents is billing the same work twice, which is both a
 * fee-dispute risk and the kind of thing that is very hard to spot once the
 * invoice has gone out.
 */
export const markInvoiced = (
  entry: TimeEntry,
): Either.Either<TimeEntry, AlreadyInvoiced> =>
  entry.invoiced
    ? Either.left(new AlreadyInvoiced({ narrative: entry.narrative }))
    : Either.right({ ...entry, invoiced: true });

/** Entries not yet carried onto a fee note, for a given matter. */
export const unbilledFor = (
  entries: readonly TimeEntry[],
  caseId: CaseId,
): readonly TimeEntry[] =>
  entries.filter(
    (entry) => entry.caseId === caseId && entry.billable && !entry.invoiced,
  );
