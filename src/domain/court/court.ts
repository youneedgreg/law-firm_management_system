import { Either, Schema } from "effect";
import * as Money from "../shared/money";

/**
 * The Kenyan court hierarchy, and the pecuniary limits that decide where a
 * civil matter may be filed.
 *
 * A court is a tagged union rather than a string. "Milimani Commercial Court"
 * as free text cannot answer whether it may hear a KES 18,000,000 claim; a
 * `MagistratesCourt` carrying its rank can. See docs/domain-notes.md §1.
 */

// ── Magistrates' courts ───────────────────────────────────────────────────

export const MAGISTRATE_RANKS = [
  "Chief Magistrate",
  "Senior Principal Magistrate",
  "Principal Magistrate",
  "Senior Resident Magistrate",
  "Resident Magistrate",
] as const;

export const MagistrateRank = Schema.Literal(...MAGISTRATE_RANKS);
export type MagistrateRank = typeof MagistrateRank.Type;

/**
 * Magistrates' Courts Act (Cap. 10) s. 7(1), as at the 2022 revision.
 *
 * Deliberately a lookup table rather than constants folded into the type:
 * s. 7(2) lets the Chief Justice revise these by Gazette notice for inflation,
 * so they are figures with an effective date, not laws of nature. When they
 * change, this table is the only thing that changes.
 */
export const PECUNIARY_LIMITS: Readonly<Record<MagistrateRank, Money.Money>> = {
  "Chief Magistrate": Money.fromCents(20_000_000_00),
  "Senior Principal Magistrate": Money.fromCents(15_000_000_00),
  "Principal Magistrate": Money.fromCents(10_000_000_00),
  "Senior Resident Magistrate": Money.fromCents(7_000_000_00),
  "Resident Magistrate": Money.fromCents(5_000_000_00),
};

// ── The hierarchy ─────────────────────────────────────────────────────────

export const SupremeCourt = Schema.TaggedStruct("SupremeCourt", {});

export const CourtOfAppeal = Schema.TaggedStruct("CourtOfAppeal", {
  station: Schema.String,
});

export const HighCourt = Schema.TaggedStruct("HighCourt", {
  station: Schema.String,
  /**
   * Free text, not a closed union. The divisions (Commercial and Tax, Family,
   * Judicial Review, …) are an administrative arrangement of the Judiciary
   * rather than a statutory list — see domain-notes §1.2, still unverified.
   * Narrowing this to a union would encode an assumption the research does not
   * yet support.
   */
  division: Schema.optional(Schema.String),
});

/** Equal status to the High Court under Article 162(2) of the Constitution. */
export const EmploymentAndLabourRelationsCourt = Schema.TaggedStruct(
  "EmploymentAndLabourRelationsCourt",
  { station: Schema.String },
);

export const EnvironmentAndLandCourt = Schema.TaggedStruct(
  "EnvironmentAndLandCourt",
  { station: Schema.String },
);

export const MagistratesCourt = Schema.TaggedStruct("MagistratesCourt", {
  station: Schema.String,
  rank: MagistrateRank,
});

export const Court = Schema.Union(
  SupremeCourt,
  CourtOfAppeal,
  HighCourt,
  EmploymentAndLabourRelationsCourt,
  EnvironmentAndLandCourt,
  MagistratesCourt,
);

export type Court = typeof Court.Type;
export type MagistratesCourt = typeof MagistratesCourt.Type;

// ── Jurisdiction ──────────────────────────────────────────────────────────

/**
 * What a court needs to know about a matter to decide whether it may hear it.
 *
 * `underCustomaryLaw` is not decoration: s. 7(3) exempts claims under customary
 * law — customary land tenure, marriage, divorce, succession — from the
 * pecuniary limit entirely. A check that looked only at value would wrongly
 * reject them.
 */
export interface MatterForFiling {
  readonly value: Money.Money;
  readonly underCustomaryLaw: boolean;
}

export class OutsideCourtJurisdiction extends Schema.TaggedError<OutsideCourtJurisdiction>()(
  "OutsideCourtJurisdiction",
  {
    rank: MagistrateRank,
    limit: Schema.Number,
    value: Schema.Number,
  },
) {
  get reason(): string {
    return (
      `A court presided over by a ${this.rank} may hear civil matters up to ` +
      `${Money.format(this.limit as Money.Money)}; this matter is valued at ` +
      `${Money.format(this.value as Money.Money)} ` +
      `(Magistrates' Courts Act s. 7(1))`
    );
  }
}

/**
 * Whether a court may hear a matter, given its value.
 *
 * Superior courts have unlimited pecuniary jurisdiction, so only magistrates'
 * courts can fail this check. Returns `Either` rather than a boolean so the
 * caller gets the reason — the rank, the limit, and the provision — instead of
 * a bare `false` it would have to explain to an advocate.
 */
export const canHear = (
  court: Court,
  matter: MatterForFiling,
): Either.Either<Court, OutsideCourtJurisdiction> => {
  if (court._tag !== "MagistratesCourt") return Either.right(court);

  // s. 7(3): customary law claims are not limited by value.
  if (matter.underCustomaryLaw) return Either.right(court);

  const limit = PECUNIARY_LIMITS[court.rank];

  return Money.greaterThan(matter.value, limit)
    ? Either.left(
        new OutsideCourtJurisdiction({
          rank: court.rank,
          limit,
          value: matter.value,
        }),
      )
    : Either.right(court);
};

/** The lowest-ranked magistrate who may hear a matter of this value, if any. */
export const lowestCompetentRank = (
  value: Money.Money,
): MagistrateRank | undefined =>
  [...MAGISTRATE_RANKS]
    .reverse()
    .find((rank) => !Money.greaterThan(value, PECUNIARY_LIMITS[rank]));
