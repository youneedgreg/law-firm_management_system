import type * as Court from "@/domain/court/court";
import { courtName } from "./display";

/**
 * The courts this firm files in, as a list a form can offer.
 *
 * A `Court` is a tagged union carrying a station and, for magistrates' courts,
 * a rank — three fields that decide jurisdiction between them. Asking a form to
 * assemble one out of four free-text inputs invites the combinations the schema
 * exists to forbid: a Supreme Court with a Resident Magistrate presiding, a
 * division on a court that does not sit in divisions.
 *
 * So the form picks a whole court by key instead, and this is the only place
 * that turns a key into one. It is also what a practice actually looks like —
 * a firm files in a known set of stations, not in an arbitrary court it types
 * out each time.
 *
 * Adding a station is one entry here. The keys are stable and appear only in
 * form submissions, never in storage, which stores the court itself.
 */
export const COURTS: Readonly<Record<string, Court.Court>> = {
  "supreme-court": { _tag: "SupremeCourt" },
  "court-of-appeal-nairobi": { _tag: "CourtOfAppeal", station: "Nairobi" },
  "high-court-milimani": { _tag: "HighCourt", station: "Milimani" },
  "high-court-milimani-commercial": {
    _tag: "HighCourt",
    station: "Milimani",
    division: "Commercial and Tax",
  },
  "high-court-milimani-family": {
    _tag: "HighCourt",
    station: "Milimani",
    division: "Family",
  },
  "high-court-mombasa": { _tag: "HighCourt", station: "Mombasa" },
  "elrc-nairobi": {
    _tag: "EmploymentAndLabourRelationsCourt",
    station: "Nairobi",
  },
  "elc-nairobi": { _tag: "EnvironmentAndLandCourt", station: "Nairobi" },
  "elc-mombasa": { _tag: "EnvironmentAndLandCourt", station: "Mombasa" },
  "magistrate-milimani-chief": {
    _tag: "MagistratesCourt",
    station: "Milimani",
    rank: "Chief Magistrate",
  },
  "magistrate-milimani-principal": {
    _tag: "MagistratesCourt",
    station: "Milimani",
    rank: "Principal Magistrate",
  },
  "magistrate-milimani-resident": {
    _tag: "MagistratesCourt",
    station: "Milimani",
    rank: "Resident Magistrate",
  },
  "magistrate-kibera-senior-resident": {
    _tag: "MagistratesCourt",
    station: "Kibera",
    rank: "Senior Resident Magistrate",
  },
};

/** The select's options, labelled the way the detail page names the court. */
export const COURT_OPTIONS = Object.entries(COURTS).map(([value, court]) => ({
  value,
  label: courtName(court),
}));

/** The key a given court was chosen by, for pre-selecting an edit form. */
export const keyFor = (court: Court.Court | undefined): string => {
  if (court === undefined) return "";
  const found = Object.entries(COURTS).find(
    ([, candidate]) => JSON.stringify(candidate) === JSON.stringify(court),
  );
  /**
   * A stored court with no key is not an error: the seed imports courts the
   * list above does not offer, and a matter filed in one keeps it. The select
   * simply opens unselected, and leaving it that way leaves the court alone.
   */
  return found?.[0] ?? "";
};
