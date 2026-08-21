import { Option, Schema } from "effect";
import { AdvocateId, PrecedentId } from "../shared/ids";

/**
 * The precedent bank: the firm's own library.
 *
 * Annotated Acts, pleading templates, case-law digests — the things a firm
 * accumulates and then cannot find. The prototype had five titles and a
 * search box.
 *
 * ## What makes this more than a list of links
 *
 * **`reviewedOn`.** A precedent bank's failure mode is not being empty; it is
 * being *stale*. An annotated Employment Act from 2019 looks exactly like one
 * from last month in a list of titles, and somebody drafts from it. Every entry
 * records when it was last checked against the law, and `needsReview` is the
 * list that follows.
 *
 * That is why this is a domain module rather than a table of URLs: "is this
 * still good law" is a question with a rule behind it, and the rule is here.
 */

export const CATEGORIES = [
  "Acts",
  "Legal templates",
  "Case law",
  "Precedents",
  "Practice notes",
] as const;

export const Category = Schema.Literal(...CATEGORIES);
export type Category = typeof Category.Type;

export const Precedent = Schema.Struct({
  id: PrecedentId,
  title: Schema.NonEmptyTrimmedString,
  category: Category,
  /**
   * Where it is. A URL, a shelf, a document reference — free text on purpose:
   * half a real firm's precedent bank is a lever-arch file, and a field that
   * only accepted a URL would exclude it and be quietly wrong about the rest.
   */
  location: Schema.NonEmptyTrimmedString,
  /** Who added it, so a question about it has somebody to go to. */
  addedBy: AdvocateId,
  addedOn: Schema.DateFromSelf,
  /**
   * When somebody last checked it was still good law.
   *
   * Absent means never — which is not the same as "added and therefore
   * checked". A precedent nobody has reviewed since it was filed is exactly the
   * one to be careful of, and an `Option` says so where a default of `addedOn`
   * would have quietly claimed a review that never happened.
   */
  reviewedOn: Schema.Option(Schema.DateFromSelf),
  /** A line about what it is for, where the title does not say. */
  note: Schema.optional(Schema.NonEmptyTrimmedString),
});

export type Precedent = typeof Precedent.Type;

/**
 * How long a precedent is trusted before somebody should look again.
 *
 * A year. Long enough not to be noise, short enough to catch a Finance Act —
 * Kenya passes one annually, and it moves the ground under any tax precedent in
 * the bank.
 */
export const REVIEW_INTERVAL_DAYS = 365;

const days = (of: number) => of * 24 * 60 * 60 * 1000;

/** When this entry was last known good — its review, or its filing. */
export const lastVerified = (precedent: Precedent): Date =>
  Option.getOrElse(precedent.reviewedOn, () => precedent.addedOn);

export const isStale = (precedent: Precedent, asAt: Date): boolean =>
  asAt.getTime() - lastVerified(precedent).getTime() >
  days(REVIEW_INTERVAL_DAYS);

/**
 * Entries nobody has checked within the interval, oldest first.
 *
 * The list that makes the bank trustworthy: not what is in it, but what in it
 * should not be relied on without a second look.
 */
export const needsReview = (
  precedents: readonly Precedent[],
  asAt: Date,
): readonly Precedent[] =>
  precedents
    .filter((precedent) => isStale(precedent, asAt))
    .sort((a, b) => lastVerified(a).getTime() - lastVerified(b).getTime());

/**
 * Search over title, category and note.
 *
 * In the domain rather than in a SQL `ILIKE`, and the reason is the bank's
 * size: a firm's precedent list is tens of entries, not thousands, and a
 * round trip per keystroke to filter forty rows is the wrong trade. The
 * *global* search in the next slice is a different problem with a different
 * answer.
 *
 * Case- and accent-insensitive, and matches any term rather than the whole
 * phrase: somebody typing "employment act" should find "Employment Act, 2007
 * (annotated)", and requiring the exact substring would fail on the comma.
 */
export const matching = (
  precedents: readonly Precedent[],
  query: string,
): readonly Precedent[] => {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term !== "");

  if (terms.length === 0) return precedents;

  return precedents.filter((precedent) => {
    const haystack = [precedent.title, precedent.category, precedent.note ?? ""]
      .join(" ")
      .toLowerCase();

    return terms.every((term) => haystack.includes(term));
  });
};
