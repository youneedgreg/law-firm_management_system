import { Either, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";
import * as Money from "../shared/money";
import * as Court from "./court";

const shillings = (amount: number) => Money.fromCents(amount * 100);

const magistrate = (rank: Court.MagistrateRank): Court.Court => ({
  _tag: "MagistratesCourt",
  station: "Milimani",
  rank,
});

const civilMatter = (value: number) => ({
  value: shillings(value),
  underCustomaryLaw: false,
});

describe("pecuniary limits (Magistrates' Courts Act s. 7(1))", () => {
  it("matches the statutory figures for every rank", () => {
    expect(Court.PECUNIARY_LIMITS["Chief Magistrate"]).toBe(20_000_000_00);
    expect(Court.PECUNIARY_LIMITS["Senior Principal Magistrate"]).toBe(
      15_000_000_00,
    );
    expect(Court.PECUNIARY_LIMITS["Principal Magistrate"]).toBe(10_000_000_00);
    expect(Court.PECUNIARY_LIMITS["Senior Resident Magistrate"]).toBe(
      7_000_000_00,
    );
    expect(Court.PECUNIARY_LIMITS["Resident Magistrate"]).toBe(5_000_000_00);
  });

  it("orders the ranks from most to least senior", () => {
    const limits = Court.MAGISTRATE_RANKS.map(
      (rank) => Court.PECUNIARY_LIMITS[rank],
    );
    expect(limits).toStrictEqual([...limits].sort((a, b) => b - a));
  });
});

describe("canHear", () => {
  it("admits a matter at exactly the limit", () => {
    const result = Court.canHear(
      magistrate("Chief Magistrate"),
      civilMatter(20_000_000),
    );
    expect(Either.isRight(result)).toBe(true);
  });

  it("refuses a matter one cent over the limit", () => {
    const result = Court.canHear(magistrate("Chief Magistrate"), {
      value: Money.fromCents(20_000_000_01),
      underCustomaryLaw: false,
    });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("explains a refusal with the rank, limit, and provision", () => {
    const result = Court.canHear(
      magistrate("Resident Magistrate"),
      civilMatter(9_000_000),
    );

    // getLeft yields an Option, so unwrap before asserting on the error.
    const error = Option.getOrThrow(Either.getLeft(result));
    expect(error.rank).toBe("Resident Magistrate");
    expect(error.reason).toContain("Resident Magistrate");
    expect(error.reason).toContain("s. 7(1)");
  });

  it("lets superior courts hear a matter of any value", () => {
    const enormous = civilMatter(500_000_000);
    const superior: readonly Court.Court[] = [
      { _tag: "SupremeCourt" },
      { _tag: "CourtOfAppeal", station: "Nairobi" },
      {
        _tag: "HighCourt",
        station: "Milimani",
        division: "Commercial and Tax",
      },
      { _tag: "EmploymentAndLabourRelationsCourt", station: "Nairobi" },
      { _tag: "EnvironmentAndLandCourt", station: "Nairobi" },
    ];

    for (const court of superior) {
      expect(Either.isRight(Court.canHear(court, enormous))).toBe(true);
    }
  });

  it("exempts customary law claims from the limit (s. 7(3))", () => {
    // A succession dispute over customary land far exceeding the rank's
    // pecuniary limit is still within jurisdiction.
    const result = Court.canHear(magistrate("Resident Magistrate"), {
      value: shillings(80_000_000),
      underCustomaryLaw: true,
    });

    expect(Either.isRight(result)).toBe(true);
  });
});

describe("lowestCompetentRank", () => {
  it("finds the most junior magistrate who may hear the matter", () => {
    expect(Court.lowestCompetentRank(shillings(4_000_000))).toBe(
      "Resident Magistrate",
    );
    expect(Court.lowestCompetentRank(shillings(6_000_000))).toBe(
      "Senior Resident Magistrate",
    );
    expect(Court.lowestCompetentRank(shillings(18_000_000))).toBe(
      "Chief Magistrate",
    );
  });

  it("finds none when the matter exceeds every limit", () => {
    expect(Court.lowestCompetentRank(shillings(25_000_000))).toBeUndefined();
  });
});

describe("Court schema", () => {
  it("decodes a magistrates' court", () => {
    const decoded = Schema.decodeUnknownSync(Court.Court)({
      _tag: "MagistratesCourt",
      station: "Mombasa",
      rank: "Principal Magistrate",
    });

    expect(decoded._tag).toBe("MagistratesCourt");
  });

  it("rejects a rank that does not exist", () => {
    const result = Schema.decodeUnknownEither(Court.Court)({
      _tag: "MagistratesCourt",
      station: "Mombasa",
      rank: "Assistant Magistrate",
    });

    expect(Either.isLeft(result)).toBe(true);
  });
});
