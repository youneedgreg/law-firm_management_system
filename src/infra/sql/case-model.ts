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
import {
  absentCourt,
  CourtKind,
  flattenCourt,
  rebuildCourt,
} from "./court-columns";

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
  opposingParties: Schema.Array(Schema.NonEmptyTrimmedString),
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
        opposingParties: row.opposingParties,
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
        opposingParties: matter.opposingParties,
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
