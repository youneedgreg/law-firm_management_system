import { Schema } from "effect";

/**
 * Limitation periods under the Limitation of Actions Act (Cap. 22), s. 4.
 * See docs/domain-notes.md §3.1.
 *
 * **This computes a prompt, not an authority.** Section 27 permits extension of
 * the tort period where the plaintiff was ignorant of material facts, and that
 * turns on evidence no software has. A date produced here means "look at this
 * matter", never "this claim is time-barred". Every result therefore carries
 * the provision it came from, so the advocate can check the reasoning rather
 * than trust a bare date.
 */

export const LIMITATION_BASES = [
  "contract",
  "tort",
  "defamation",
  "personal injury",
] as const;

export const LimitationBasis = Schema.Literal(...LIMITATION_BASES);
export type LimitationBasis = typeof LimitationBasis.Type;

interface Period {
  readonly years?: number;
  readonly months?: number;
  readonly provision: string;
  readonly note?: string;
}

const PERIODS: Readonly<Record<LimitationBasis, Period>> = {
  contract: {
    years: 6,
    provision: "Limitation of Actions Act (Cap. 22) s. 4(1)(a)",
  },
  tort: {
    years: 3,
    provision: "Limitation of Actions Act (Cap. 22) s. 4(2)",
    note: "May be extended under s. 27 where the plaintiff was ignorant of material facts.",
  },
  defamation: {
    months: 12,
    provision: "Limitation of Actions Act (Cap. 22) s. 4(2), proviso",
  },
  // Treated as tort. The distinct s. 27 regime for personal injury turns on
  // the plaintiff's knowledge and is not modelled — see domain-notes §3.1.
  "personal injury": {
    years: 3,
    provision: "Limitation of Actions Act (Cap. 22) s. 4(2)",
    note: "Personal injury claims are commonly extended under s. 27; treat this date as indicative only.",
  },
};

export interface LimitationWindow {
  /** The last day on which the action may be brought. */
  readonly expiresOn: Date;
  /** The statutory provision the period comes from, for citation in the UI. */
  readonly provision: string;
  /** Where the period is commonly extended, why. */
  readonly note?: string;
}

/**
 * Adds whole months to a date, clamping to the end of the target month.
 *
 * `setMonth` overflows: 31 January plus one month becomes 3 March, which would
 * hand back a limitation date two days later than the law allows. Clamping to
 * 28 February is the conservative reading, and being early on a limitation
 * prompt is the harmless direction to be wrong in.
 */
const addMonths = (date: Date, months: number): Date => {
  const result = new Date(date.getTime());
  const targetMonth = result.getUTCMonth() + months;
  const day = result.getUTCDate();

  result.setUTCDate(1);
  result.setUTCMonth(targetMonth);

  const lastDayOfTargetMonth = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();

  result.setUTCDate(Math.min(day, lastDayOfTargetMonth));
  return result;
};

/**
 * When the limitation period expires for a cause of action that accrued on
 * `accruedOn`.
 *
 * Time runs from accrual, not from filing, instruction, or discovery.
 */
export const limitationWindow = (
  basis: LimitationBasis,
  accruedOn: Date,
): LimitationWindow => {
  const period = PERIODS[basis];
  const months = (period.years ?? 0) * 12 + (period.months ?? 0);

  return {
    expiresOn: addMonths(accruedOn, months),
    provision: period.provision,
    ...(period.note === undefined ? {} : { note: period.note }),
  };
};

/** Whole days from `on` until the period expires. Negative once it has passed. */
export const daysRemaining = (window: LimitationWindow, on: Date): number => {
  const msPerDay = 24 * 60 * 60 * 1000;
  const from = Date.UTC(on.getUTCFullYear(), on.getUTCMonth(), on.getUTCDate());
  const to = Date.UTC(
    window.expiresOn.getUTCFullYear(),
    window.expiresOn.getUTCMonth(),
    window.expiresOn.getUTCDate(),
  );
  return Math.round((to - from) / msPerDay);
};

export type Urgency = "expired" | "critical" | "approaching" | "comfortable";

/**
 * How loudly the diary should be shouting about this matter.
 *
 * The thresholds are a practice-management judgement, not a legal one: 30 days
 * is roughly the point where preparing and filing becomes tight, and 90 is far
 * enough out to plan around.
 */
export const urgency = (window: LimitationWindow, on: Date): Urgency => {
  const days = daysRemaining(window, on);
  if (days < 0) return "expired";
  if (days <= 30) return "critical";
  if (days <= 90) return "approaching";
  return "comfortable";
};
