import * as Court from "@/domain/court/court";
import type * as Limitation from "@/domain/case/limitation";
import type { TagClass } from "@/lib/types";

/**
 * A court as a firm writes it.
 *
 * The rank is shown for magistrates' courts because it is the fact that decides
 * what the court may hear, and an advocate reading "Milimani" alone cannot tell
 * a Resident Magistrate's 5m ceiling from a Chief Magistrate's 20m one.
 */
export const courtName = (court: Court.Court | undefined): string =>
  court === undefined ? "Not filed in a court" : Court.describe(court);

/** A calendar date in the house format, e.g. `19 Aug 2026`. Absent reads plain. */
export const day = (date: Date | undefined): string =>
  date === undefined
    ? "—"
    : date.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });

/** The `<input type="date">` value for a date, in UTC. */
export const dateInputValue = (date: Date | undefined): string =>
  date === undefined ? "" : date.toISOString().slice(0, 10);

const URGENCY_TAG: Record<Limitation.Urgency, TagClass> = {
  expired: "tag tag-accent-2",
  critical: "tag tag-accent-2",
  approaching: "tag tag-outline",
  comfortable: "tag tag-neutral",
};

export const urgencyTag = (urgency: Limitation.Urgency): TagClass =>
  URGENCY_TAG[urgency];

/**
 * The limitation position in a sentence.
 *
 * Reads the count out rather than showing a bare number, because "-412" next to
 * a date is the kind of figure that gets misread as a countdown by whoever is
 * skimming, and this one is the difference between a claim that can be brought
 * and one that cannot.
 */
export const limitationSummary = (
  daysRemaining: number,
  urgency: Limitation.Urgency,
): string => {
  if (urgency === "expired") {
    const days = Math.abs(daysRemaining);
    return `Expired ${days} ${days === 1 ? "day" : "days"} ago`;
  }
  if (daysRemaining === 0) return "Expires today";
  return `${daysRemaining} ${daysRemaining === 1 ? "day" : "days"} remaining`;
};
