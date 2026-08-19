import { Model } from "@effect/sql";
import { Option, ParseResult, Schema } from "effect";
import * as Matter from "../../domain/case/case";
import * as Limitation from "../../domain/case/limitation";
import * as Status from "../../domain/case/status";
import * as Court from "../../domain/court/court";
import {
  AdvocateId,
  CaseId,
  CaseNumber,
  ClientId,
} from "../../domain/shared/ids";
import { CalendarDate, Cents } from "./columns";

/**
 * The `cases` table, and the bridge between a row and a `Case`.
 *
 * A row is flat because that is what a table is. The domain's `Case` is not:
 * its court is a tagged union carrying only the fields that court actually has,
 * and its optional fields are absent rather than null. Something has to
 * reconcile the two, and this is the only file allowed to know how.
 *
 * The reconciliation is a `Schema.transformOrFail` rather than a pair of
 * hand-written functions, for one reason worth stating: a schema has an encode
 * side. **Reads and writes go through the same mapping**, so a column that is
 * read one way and written another is not expressible here. Two functions drift;
 * this cannot.
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

/**
 * The row model.
 *
 * `created_at` is `Model.Generated`: the database supplies it, so it appears in
 * the select variant and not the insert one. Everything below is built on
 * `CaseRow.insert` for that reason — the mapping covers the columns the
 * application owns, and cannot accidentally claim to own the timestamp.
 */
export class CaseRow extends Model.Class<CaseRow>("CaseRow")({
  id: CaseId,
  number: CaseNumber,
  causeNumber: Model.FieldOption(Schema.NonEmptyTrimmedString),
  title: Schema.NonEmptyTrimmedString,
  type: Matter.MatterType,
  status: Status.CaseStatus,
  clientId: ClientId,
  advocateId: AdvocateId,
  courtKind: Model.FieldOption(CourtKind),
  courtStation: Model.FieldOption(Schema.String),
  courtDivision: Model.FieldOption(Schema.String),
  courtRank: Model.FieldOption(Court.MagistrateRank),
  claimValueCents: Model.FieldOption(Cents),
  underCustomaryLaw: Schema.Boolean,
  accruedOn: Model.FieldOption(CalendarDate),
  limitationBasis: Model.FieldOption(Limitation.LimitationBasis),
  openedOn: CalendarDate,
  filedOn: Model.FieldOption(CalendarDate),
  createdAt: Model.Generated(Schema.DateFromSelf),
}) {}

// ── Court, flattened and reassembled ──────────────────────────────────────

interface CourtColumns {
  readonly courtKind: Option.Option<CourtKind>;
  readonly courtStation: Option.Option<string>;
  readonly courtDivision: Option.Option<string>;
  readonly courtRank: Option.Option<Court.MagistrateRank>;
}

const absentCourt: CourtColumns = {
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
const flattenCourt = (court: Court.Court): CourtColumns => {
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
const rebuildCourt = (
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

// ── The bridge ────────────────────────────────────────────────────────────

/**
 * A `cases` row as a `Case`, and back.
 *
 * Encoded side: the record the driver hands over and the record `sql.insert`
 * takes. Type side: the domain entity. `SqlSchema.findAll` decodes straight
 * into `Case`, so no query result is ever handled as a bag of columns.
 */
export const CaseFromRow = Schema.transformOrFail(
  CaseRow.insert,
  /**
   * `typeSchema`, not `Matter.Case` itself. The domain schema's encoded side is
   * unbranded strings and would have this mapping hand back a `string` where a
   * `CaseId` is expected. The row model has already branded everything; what is
   * wanted here is the domain's *type* — refinements and all, so a title that
   * is blank in the database is still refused.
   */
  Schema.typeSchema(Matter.Case),
  {
    strict: true,

    decode: (row, _options, ast) => {
      const court = rebuildCourt(row);
      if (!Option.isOption(court)) {
        return ParseResult.fail(
          new ParseResult.Type(
            ast,
            row,
            `case ${row.number}: ${court.missing}`,
          ),
        );
      }

      const causeNumber = Option.getOrUndefined(row.causeNumber);
      const claimValueCents = Option.getOrUndefined(row.claimValueCents);
      const accruedOn = Option.getOrUndefined(row.accruedOn);
      const limitationBasis = Option.getOrUndefined(row.limitationBasis);
      const filedOn = Option.getOrUndefined(row.filedOn);

      return ParseResult.succeed({
        id: row.id,
        number: row.number,
        title: row.title,
        type: row.type,
        status: row.status,
        clientId: row.clientId,
        advocateId: row.advocateId,
        underCustomaryLaw: row.underCustomaryLaw,
        openedOn: row.openedOn,
        ...(causeNumber === undefined ? {} : { causeNumber }),
        ...(Option.isNone(court) ? {} : { court: court.value }),
        ...(claimValueCents === undefined ? {} : { claimValueCents }),
        ...(accruedOn === undefined ? {} : { accruedOn }),
        ...(limitationBasis === undefined ? {} : { limitationBasis }),
        ...(filedOn === undefined ? {} : { filedOn }),
      } satisfies Matter.Case);
    },

    encode: (matter) =>
      ParseResult.succeed({
        id: matter.id,
        number: matter.number,
        causeNumber: Option.fromNullable(matter.causeNumber),
        title: matter.title,
        type: matter.type,
        status: matter.status,
        clientId: matter.clientId,
        advocateId: matter.advocateId,
        ...(matter.court === undefined
          ? absentCourt
          : flattenCourt(matter.court)),
        claimValueCents: Option.fromNullable(matter.claimValueCents),
        underCustomaryLaw: matter.underCustomaryLaw,
        accruedOn: Option.fromNullable(matter.accruedOn),
        limitationBasis: Option.fromNullable(matter.limitationBasis),
        openedOn: matter.openedOn,
        filedOn: Option.fromNullable(matter.filedOn),
      }),
  },
).annotations({ identifier: "CaseFromRow" });
