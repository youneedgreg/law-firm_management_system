import { Either, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";
import * as Court from "../court/court";
import { AdvocateId, CaseId, CaseNumber, ClientId } from "../shared/ids";
import * as Money from "../shared/money";
import * as Matter from "./case";

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

const base: Matter.Case = {
  id: Schema.decodeSync(CaseId)("20000000-0000-4000-8000-000000000001"),
  number: Schema.decodeSync(CaseNumber)("OKL-2026-014"),
  title: "Wanjiku Mwangi v. Nairobi Metro SACCO",
  opposingParties: ["Nairobi Metro SACCO"],
  type: "Civil",
  status: "New",
  clientId: Schema.decodeSync(ClientId)("00000000-0000-4000-8000-000000000001"),
  advocateId: Schema.decodeSync(AdvocateId)(
    "40000000-0000-4000-8000-000000000001",
  ),
  underCustomaryLaw: false,
  openedOn: utc("2026-02-14"),
};

const magistrate = (rank: Court.MagistrateRank): Court.Court => ({
  _tag: "MagistratesCourt",
  station: "Milimani",
  rank,
});

describe("filing and pecuniary jurisdiction", () => {
  it("allows filing where the claim is within the rank's limit", () => {
    const matter = { ...base, claimValueCents: 4_000_000_00 };
    const result = Matter.canFileIn(matter, magistrate("Resident Magistrate"));

    expect(Either.isRight(result)).toBe(true);
  });

  it("refuses filing where the claim exceeds it", () => {
    const matter = { ...base, claimValueCents: 9_000_000_00 };
    const result = Matter.canFileIn(matter, magistrate("Resident Magistrate"));

    const error = Option.getOrThrow(Either.getLeft(result));
    expect(error._tag).toBe("OutsideCourtJurisdiction");
  });

  it("refuses a magistrates' court when no value is recorded", () => {
    // Not knowing the value is not evidence the claim is within the limit.
    const result = Matter.canFileIn(base, magistrate("Chief Magistrate"));

    const error = Option.getOrThrow(Either.getLeft(result));
    expect(error._tag).toBe("CannotFileWithoutValue");
    if (error._tag === "CannotFileWithoutValue") {
      expect(error.reason).toContain("OKL-2026-014");
    }
  });

  it("allows a valueless matter into a superior court", () => {
    const result = Matter.canFileIn(base, {
      _tag: "HighCourt",
      station: "Milimani",
    });

    expect(Either.isRight(result)).toBe(true);
  });

  it("allows a customary-law matter regardless of value (s. 7(3))", () => {
    const matter = {
      ...base,
      type: "Probate" as const,
      underCustomaryLaw: true,
      claimValueCents: 80_000_000_00,
    };

    expect(
      Either.isRight(
        Matter.canFileIn(matter, magistrate("Resident Magistrate")),
      ),
    ).toBe(true);
  });

  it("stays consistent with the court module's own rule", () => {
    // The limits live in one place. If this drifts, one of the two is stale.
    const value = Money.fromCents(6_000_000_00);
    const matter = { ...base, claimValueCents: 6_000_000_00 };
    const court = magistrate("Senior Resident Magistrate");

    expect(Either.isRight(Matter.canFileIn(matter, court))).toBe(
      Either.isRight(Court.canHear(court, { value, underCustomaryLaw: false })),
    );
  });
});

describe("limitation", () => {
  it("computes a window when accrual and basis are both known", () => {
    const matter = {
      ...base,
      accruedOn: utc("2026-02-01"),
      limitationBasis: "contract" as const,
    };

    const window = Matter.limitation(matter);
    expect(window?.expiresOn.toISOString().slice(0, 10)).toBe("2032-02-01");
  });

  it("returns nothing rather than guessing when accrual is unknown", () => {
    const matter = { ...base, limitationBasis: "contract" as const };
    expect(Matter.limitation(matter)).toBeUndefined();
  });

  it("returns nothing rather than guessing the basis", () => {
    const matter = { ...base, accruedOn: utc("2026-02-01") };
    expect(Matter.limitation(matter)).toBeUndefined();
  });
});

describe("changeStatus", () => {
  it("advances a matter through a legal transition", () => {
    const active = Either.getOrThrow(Matter.changeStatus(base, "Active"));
    expect(active.status).toBe("Active");
  });

  it("refuses an illegal one and leaves the matter alone", () => {
    const closed = { ...base, status: "Closed" as const };
    const result = Matter.changeStatus(closed, "Active");

    expect(Either.isLeft(result)).toBe(true);
    expect(closed.status).toBe("Closed");
  });
});

describe("schema constraints", () => {
  it("rejects a firm reference in the wrong format", () => {
    const result = Schema.decodeUnknownEither(Matter.Case)({
      ...base,
      number: "2026/014",
    });

    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects a blank title", () => {
    const result = Schema.decodeUnknownEither(Matter.Case)({
      ...base,
      title: "  ",
    });

    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects a matter type outside the practice areas", () => {
    const result = Schema.decodeUnknownEither(Matter.Case)({
      ...base,
      type: "Maritime",
    });

    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects a negative claim value", () => {
    const result = Schema.decodeUnknownEither(Matter.Case)({
      ...base,
      claimValueCents: -100,
    });

    expect(Either.isLeft(result)).toBe(true);
  });

  it("keeps the firm reference and the cause number apart", () => {
    const filed = Schema.decodeUnknownSync(Matter.Case)({
      ...base,
      causeNumber: "HCCC E123 of 2026",
      filedOn: utc("2026-02-18"),
    });

    expect(filed.number).toBe("OKL-2026-014");
    expect(filed.causeNumber).toBe("HCCC E123 of 2026");
    expect(Matter.isFiled(filed)).toBe(true);
  });

  it("treats an unfiled matter as unfiled", () => {
    expect(Matter.isFiled(base)).toBe(false);
  });
});

describe("consistency between fields", () => {
  it("accepts a matter filed after it was opened", () => {
    const result = Matter.consistency({
      ...base,
      openedOn: utc("2026-01-19"),
      filedOn: utc("2026-02-14"),
    });

    expect(Either.isRight(result)).toBe(true);
  });

  it("accepts a matter filed the day it was opened", () => {
    const result = Matter.consistency({
      ...base,
      openedOn: utc("2026-02-14"),
      filedOn: utc("2026-02-14"),
    });

    expect(Either.isRight(result)).toBe(true);
  });

  it("refuses a matter filed before it was opened", () => {
    const result = Matter.consistency({
      ...base,
      openedOn: utc("2026-02-14"),
      filedOn: utc("2026-01-19"),
    });

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("FilingPrecedesIntake");
      expect(result.left.reason).toContain("2026-01-19");
      expect(result.left.reason).toContain("2026-02-14");
    }
  });

  it("accepts an unfiled matter, which has no filing date to compare", () => {
    expect(Either.isRight(Matter.consistency(base))).toBe(true);
  });

  it("refuses a cause number on a matter that was never filed", () => {
    const result = Matter.consistency({
      ...base,
      causeNumber: "MCCC E0412 of 2026",
    });

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("CauseNumberWithoutFiling");
      expect(result.left.reason).toContain("MCCC E0412 of 2026");
    }
  });

  it("accepts a cause number once the matter has been filed", () => {
    const result = Matter.consistency({
      ...base,
      causeNumber: "MCCC E0412 of 2026",
      filedOn: utc("2026-02-14"),
    });

    expect(Either.isRight(result)).toBe(true);
  });

  /**
   * The Tax Appeals Tribunal is constituted under its own Act and is not in the
   * Article 162 hierarchy `Court` models. A matter filed there is filed; it just
   * has no `Court`, and refusing that would force a fixture to name a court the
   * matter was never filed in.
   */
  it("accepts a matter filed in a forum outside the court hierarchy", () => {
    const result = Matter.consistency({
      ...base,
      filedOn: utc("2026-02-14"),
      causeNumber: "TAT E014 of 2026",
    });

    expect(Either.isRight(result)).toBe(true);
  });
});

describe("the limitation clock needs both halves", () => {
  it("accepts a matter with neither an accrual date nor a basis", () => {
    expect(Either.isRight(Matter.consistency(base))).toBe(true);
  });

  it("accepts a matter with both", () => {
    const result = Matter.consistency({
      ...base,
      accruedOn: utc("2024-08-30"),
      limitationBasis: "contract",
    });

    expect(Either.isRight(result)).toBe(true);
  });

  it("refuses an accrual date with no basis to measure from it", () => {
    const result = Matter.consistency({
      ...base,
      accruedOn: utc("2024-08-30"),
    });

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("IncompleteLimitation");
      expect(result.left.reason).toContain("basis");
    }
  });

  it("refuses a basis with no date to measure from", () => {
    const result = Matter.consistency({ ...base, limitationBasis: "tort" });

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("IncompleteLimitation");
      expect(result.left.reason).toContain("accrual date");
    }
  });
});
