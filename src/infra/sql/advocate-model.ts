import { Model } from "@effect/sql";
import { Option, ParseResult, Schema } from "effect";
import * as Advocate from "../../domain/firm/advocate";
import { AdvocateId } from "../../domain/shared/ids";
import { CalendarDate } from "./columns";

/**
 * The `advocates` table, and the bridge to an `Advocate`.
 *
 * The one shape question is the practising certificate. It is a number and a
 * year together — half a certificate cannot be reasoned about, and
 * `mayAppearInCourt` needs the year, because holding one last year is not
 * holding one now. The table stores the two as separate nullable columns with
 * a `certificate_complete` constraint tying them; the domain stores one
 * optional struct. This maps between them, and refuses the half-populated row
 * the constraint is meant to prevent rather than assuming a year.
 */

const EmailAddress = Schema.String.pipe(
  Schema.pattern(/^[^@\s]+@[^@\s]+$/),
  Schema.annotations({ identifier: "EmailAddress" }),
);

export class AdvocateRow extends Model.Class<AdvocateRow>("AdvocateRow")({
  id: AdvocateId,
  name: Schema.NonEmptyTrimmedString,
  role: Advocate.Role,
  email: EmailAddress,
  certificateNumber: Model.FieldOption(Schema.NonEmptyTrimmedString),
  certificateYear: Model.FieldOption(
    Schema.Int.pipe(Schema.between(2000, 2100)),
  ),
  admittedOn: Model.FieldOption(CalendarDate),
  active: Schema.Boolean,
  createdAt: Model.Generated(Schema.DateFromSelf),
}) {}

export const AdvocateFromRow = Schema.transformOrFail(
  AdvocateRow.insert,
  Schema.typeSchema(Advocate.Advocate),
  {
    strict: true,

    decode: (row, _options, ast) => {
      const number = Option.getOrUndefined(row.certificateNumber);
      const year = Option.getOrUndefined(row.certificateYear);

      if ((number === undefined) !== (year === undefined)) {
        return ParseResult.fail(
          new ParseResult.Type(
            ast,
            row,
            `${row.name}: has half a practising certificate — a number ` +
              `without a year, or a year without a number`,
          ),
        );
      }

      const admittedOn = Option.getOrUndefined(row.admittedOn);

      return ParseResult.succeed({
        id: row.id,
        name: row.name,
        role: row.role,
        email: row.email,
        active: row.active,
        ...(number === undefined || year === undefined
          ? {}
          : { practisingCertificate: { number, year } }),
        ...(admittedOn === undefined ? {} : { admittedOn }),
      });
    },

    encode: (advocate) =>
      ParseResult.succeed({
        id: advocate.id,
        name: advocate.name,
        role: advocate.role,
        email: advocate.email,
        certificateNumber: Option.fromNullable(
          advocate.practisingCertificate?.number,
        ),
        certificateYear: Option.fromNullable(
          advocate.practisingCertificate?.year,
        ),
        admittedOn: Option.fromNullable(advocate.admittedOn),
        active: advocate.active,
      }),
  },
).annotations({ identifier: "AdvocateFromRow" });
