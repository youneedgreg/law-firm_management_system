import { Option, Schema } from "effect";
import * as Court from "../../domain/court/court";

/**
 * A court, across four columns — and back.
 *
 * Two tables store a court: `cases` and `hearings`. Both flatten the same
 * tagged union into `court_kind`, `court_station`, `court_division` and
 * `court_rank`, and both have to rebuild it on the way out, refusing the
 * combinations the union forbids.
 *
 * This lived inside `case-model.ts` until the hearings slice needed it. Copying
 * it would have been two exhaustive switches over the same union, and the
 * second one is the one that quietly stops being exhaustive when a court is
 * added — which is precisely the mistake a tagged union is chosen to prevent.
 * One flattening, used twice, and the `switch` is exhaustive by construction:
 * adding a court to the domain without adding it here is a type error.
 */

/** Mirrors the `court_kind` enum in the migration. */
export const CourtKind = Schema.Literal(
  "SupremeCourt",
  "CourtOfAppeal",
  "HighCourt",
  "EmploymentAndLabourRelationsCourt",
  "EnvironmentAndLandCourt",
  "MagistratesCourt",
);
export type CourtKind = typeof CourtKind.Type;

// ── Court, flattened and reassembled ──────────────────────────────────────

export interface CourtColumns {
  readonly courtKind: Option.Option<CourtKind>;
  readonly courtStation: Option.Option<string>;
  readonly courtDivision: Option.Option<string>;
  readonly courtRank: Option.Option<Court.MagistrateRank>;
}

export const absentCourt: CourtColumns = {
  courtKind: Option.none(),
  courtStation: Option.none(),
  courtDivision: Option.none(),
  courtRank: Option.none(),
};

/**
 * Splits a court across four columns.
 *
 * The switch is exhaustive by construction: adding a court to the domain union
 * without adding it here is a type error, which is the only reliable way to
 * keep a flattened representation honest.
 */
export const flattenCourt = (court: Court.Court): CourtColumns => {
  switch (court._tag) {
    case "SupremeCourt":
      // The one court with no station: there is a single Supreme Court.
      return { ...absentCourt, courtKind: Option.some("SupremeCourt") };

    case "HighCourt":
      return {
        courtKind: Option.some("HighCourt"),
        courtStation: Option.some(court.station),
        courtDivision: Option.fromNullable(court.division),
        courtRank: Option.none(),
      };

    case "MagistratesCourt":
      return {
        courtKind: Option.some("MagistratesCourt"),
        courtStation: Option.some(court.station),
        courtDivision: Option.none(),
        courtRank: Option.some(court.rank),
      };

    case "CourtOfAppeal":
    case "EmploymentAndLabourRelationsCourt":
    case "EnvironmentAndLandCourt":
      return {
        ...absentCourt,
        courtKind: Option.some(court._tag),
        courtStation: Option.some(court.station),
      };
  }
};

/**
 * Rebuilds a court from four columns, or explains what the row is missing.
 *
 * The database constrains all of this already — `rank_iff_magistrates_court`,
 * `station_present`, `division_only_for_high_court`. This still checks, because
 * "the constraint should have caught it" is not a reason to construct a
 * `MagistratesCourt` with an undefined rank and let the pecuniary check read it.
 */
export const rebuildCourt = (
  columns: CourtColumns,
): Option.Option<Court.Court> | { readonly missing: string } => {
  if (Option.isNone(columns.courtKind)) return Option.none();

  const kind = columns.courtKind.value;

  // Taken first, because it is the one court that legitimately has no station.
  if (kind === "SupremeCourt") return Option.some(Court.SupremeCourt.make({}));

  const station = Option.getOrUndefined(columns.courtStation);
  if (station === undefined || station.trim() === "") {
    return { missing: `court_kind is ${kind} but court_station is empty` };
  }

  switch (kind) {
    case "CourtOfAppeal":
      return Option.some(Court.CourtOfAppeal.make({ station }));

    case "EmploymentAndLabourRelationsCourt":
      return Option.some(
        Court.EmploymentAndLabourRelationsCourt.make({ station }),
      );

    case "EnvironmentAndLandCourt":
      return Option.some(Court.EnvironmentAndLandCourt.make({ station }));

    case "HighCourt": {
      const division = Option.getOrUndefined(columns.courtDivision);
      return Option.some(
        Court.HighCourt.make({
          station,
          ...(division === undefined ? {} : { division }),
        }),
      );
    }

    case "MagistratesCourt":
      return Option.isNone(columns.courtRank)
        ? { missing: "court_kind is MagistratesCourt but court_rank is null" }
        : Option.some(
            Court.MagistratesCourt.make({
              station,
              rank: columns.courtRank.value,
            }),
          );
  }
};
