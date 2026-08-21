import { Either, Schema } from "effect";
import { describe, expect, it } from "vitest";
import type * as Matter from "../../domain/case/case";
import * as Court from "../../domain/court/court";
import {
  AdvocateId,
  CaseId,
  CaseNumber,
  ClientId,
} from "../../domain/shared/ids";
import { CaseFromRow } from "./case-model";

/**
 * The row ↔ `Case` bridge, without a database.
 *
 * Everything interesting about this mapping is decided before any SQL runs: a
 * tagged union has to survive being spread across four nullable columns and put
 * back together. That is testable in microseconds, and it is where the bugs
 * are — the integration tests exist to prove the SQL is well-formed, not to
 * discover that a magistrate's rank went missing.
 */

const id = Schema.decodeSync(CaseId)("11111111-1111-4111-8111-111111111111");
const clientId = Schema.decodeSync(ClientId)(
  "22222222-2222-4222-8222-222222222222",
);
const advocateId = Schema.decodeSync(AdvocateId)(
  "33333333-3333-4333-8333-333333333333",
);
const number = Schema.decodeSync(CaseNumber)("OKL-2026-014");

/** The minimum a matter needs: no court, no value, not filed. */
const bare: Matter.Case = {
  id,
  number,
  title: "Wanjiku Mwangi v. Nairobi Metro SACCO",
  opposingParties: ["Nairobi Metro SACCO"],
  type: "Civil",
  status: "New",
  clientId,
  advocateId,
  underCustomaryLaw: false,
  openedOn: new Date("2026-02-14T00:00:00.000Z"),
};

const encode = Schema.encodeSync(CaseFromRow);
const decode = Schema.decodeUnknownSync(CaseFromRow);
const decodeEither = Schema.decodeUnknownEither(CaseFromRow);

const roundTrip = (matter: Matter.Case) => decode(encode(matter));

describe("a matter survives the round trip", () => {
  it("with nothing optional set", () => {
    expect(roundTrip(bare)).toStrictEqual(bare);
  });

  /**
   * The one that matters. Each court carries a different set of fields, and the
   * table has one nullable column per field across all of them; a mapping that
   * confuses two courts still typechecks.
   */
  const courts: readonly Court.Court[] = [
    Court.SupremeCourt.make({}),
    Court.CourtOfAppeal.make({ station: "Nairobi" }),
    Court.HighCourt.make({ station: "Milimani" }),
    Court.HighCourt.make({
      station: "Milimani",
      division: "Commercial and Tax",
    }),
    Court.EmploymentAndLabourRelationsCourt.make({ station: "Nairobi" }),
    Court.EnvironmentAndLandCourt.make({ station: "Mombasa" }),
    Court.MagistratesCourt.make({
      station: "Milimani",
      rank: "Chief Magistrate",
    }),
    Court.MagistratesCourt.make({
      station: "Kibera",
      rank: "Resident Magistrate",
    }),
  ];

  it.each(courts.map((court) => [court._tag, court] as const))(
    "with a %s",
    (_tag, court) => {
      expect(roundTrip({ ...bare, court })).toStrictEqual({ ...bare, court });
    },
  );

  it("with every optional field populated", () => {
    const full: Matter.Case = {
      ...bare,
      causeNumber: "HCCC E123 of 2026",
      status: "Hearing Scheduled",
      court: Court.HighCourt.make({
        station: "Milimani",
        division: "Commercial and Tax",
      }),
      claimValueCents: 18_000_000_00,
      underCustomaryLaw: true,
      accruedOn: new Date("2025-11-02T00:00:00.000Z"),
      limitationBasis: "contract",
      filedOn: new Date("2026-03-01T00:00:00.000Z"),
    };

    expect(roundTrip(full)).toStrictEqual(full);
  });

  it("keeps an unfiled matter unfiled, rather than dating it to the epoch", () => {
    const row = encode(bare);

    expect(row.filedOn).toBeNull();
    expect(decode(row)).not.toHaveProperty("filedOn");
  });
});

describe("columns become a court, or say why they cannot", () => {
  const rowWith = (overrides: Record<string, unknown>) => ({
    ...encode(bare),
    ...overrides,
  });

  it("refuses a magistrates' court with no rank", () => {
    const result = decodeEither(
      rowWith({ courtKind: "MagistratesCourt", courtStation: "Milimani" }),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.message).toContain("court_rank is null");
    }
  });

  it("refuses a court with no station", () => {
    const result = decodeEither(rowWith({ courtKind: "HighCourt" }));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.message).toContain("court_station is empty");
    }
  });

  it("refuses a station that is only whitespace", () => {
    expect(
      Either.isLeft(
        decodeEither(
          rowWith({ courtKind: "CourtOfAppeal", courtStation: "  " }),
        ),
      ),
    ).toBe(true);
  });

  it("accepts the Supreme Court without a station, because there is one", () => {
    const decoded = decode(rowWith({ courtKind: "SupremeCourt" }));

    expect(decoded.court).toStrictEqual(Court.SupremeCourt.make({}));
  });

  it("drops a division that does not belong to the court", () => {
    // The `division_only_for_high_court` constraint stops this being written,
    // so the mapping does not need to preserve it — but it must not crash.
    const decoded = decode(
      rowWith({
        courtKind: "CourtOfAppeal",
        courtStation: "Nairobi",
        courtDivision: "Commercial and Tax",
      }),
    );

    expect(decoded.court).toStrictEqual(
      Court.CourtOfAppeal.make({ station: "Nairobi" }),
    );
  });
});

describe("the column types the driver actually hands over", () => {
  it("reads a claim value arriving as a bigint string", () => {
    const decoded = decode({
      ...encode(bare),
      claimValueCents: "1800000000",
    });

    expect(decoded.claimValueCents).toBe(1_800_000_000);
  });

  it("reads dates arriving as the driver's local-midnight Date", () => {
    const decoded = decode({
      ...encode(bare),
      openedOn: new Date(2026, 1, 14, 0, 0, 0),
    });

    expect(decoded.openedOn).toStrictEqual(
      new Date("2026-02-14T00:00:00.000Z"),
    );
  });

  it("refuses a row whose title is blank", () => {
    expect(Either.isLeft(decodeEither({ ...encode(bare), title: "   " }))).toBe(
      true,
    );
  });

  it("refuses a row whose status is not one the domain knows", () => {
    expect(
      Either.isLeft(decodeEither({ ...encode(bare), status: "Struck Out" })),
    ).toBe(true);
  });
});
