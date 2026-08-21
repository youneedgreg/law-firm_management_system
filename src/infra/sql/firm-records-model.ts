import { Model } from "@effect/sql";
import { Option, ParseResult, Schema } from "effect";
import * as Log from "../../domain/firm/contact";
import * as Library from "../../domain/firm/precedent";
import {
  AdvocateId,
  CaseId,
  ClientId,
  ContactId,
  PrecedentId,
} from "../../domain/shared/ids";
import { CalendarDate } from "./columns";

/**
 * The `contacts` and `precedents` tables.
 *
 * Both map almost one-to-one, which is worth saying explicitly rather than
 * leaving a reader to wonder what was elided: neither has a union to flatten,
 * neither has an invariant spread across columns, and the only work here is
 * `Option` handling and the `date` columns that `CalendarDate` exists for.
 *
 * That is what a *lighter* slice looks like from the infrastructure side, and
 * the contrast is the point — `message-model.ts` next door refuses four
 * combinations of two columns because the domain has a tagged union behind
 * them. When there is nothing to protect, there should be nothing here.
 */

export class ContactRow extends Model.Class<ContactRow>("ContactRow")({
  id: ContactId,
  clientId: ClientId,
  caseId: Model.FieldOption(CaseId),
  channel: Log.Channel,
  direction: Log.Direction,
  loggedBy: AdvocateId,
  summary: Schema.NonEmptyTrimmedString,
  occurredOn: CalendarDate,
}) {}

export const ContactFromRow = Schema.transformOrFail(
  ContactRow.insert,
  Schema.typeSchema(Log.Contact),
  {
    strict: true,
    decode: (row) => ParseResult.succeed(row),
    encode: (contact) => ParseResult.succeed(contact),
  },
);

export const contactRow: (
  contact: Log.Contact,
) => typeof ContactRow.insert.Encoded = (contact) =>
  Schema.encodeSync(ContactFromRow)(contact);

export class PrecedentRow extends Model.Class<PrecedentRow>("PrecedentRow")({
  id: PrecedentId,
  title: Schema.NonEmptyTrimmedString,
  category: Library.Category,
  location: Schema.NonEmptyTrimmedString,
  addedBy: AdvocateId,
  addedOn: CalendarDate,
  reviewedOn: Model.FieldOption(CalendarDate),
  note: Model.FieldOption(Schema.NonEmptyTrimmedString),
}) {}

export const PrecedentFromRow = Schema.transformOrFail(
  PrecedentRow.insert,
  Schema.typeSchema(Library.Precedent),
  {
    strict: true,

    /**
     * `note` is the one field the two shapes disagree about, and only in how
     * absence is spelled: the domain uses `Schema.optional` — absent from the
     * object — and the row uses `Option`. Everything else passes through.
     */
    decode: (row) => {
      const note = row.note;
      return ParseResult.succeed({
        id: row.id,
        title: row.title,
        category: row.category,
        location: row.location,
        addedBy: row.addedBy,
        addedOn: row.addedOn,
        reviewedOn: row.reviewedOn,
        ...(note._tag === "Some" ? { note: note.value } : {}),
      });
    },

    encode: (precedent) =>
      ParseResult.succeed({
        id: precedent.id,
        title: precedent.title,
        category: precedent.category,
        location: precedent.location,
        addedBy: precedent.addedBy,
        addedOn: precedent.addedOn,
        reviewedOn: precedent.reviewedOn,
        note:
          precedent.note === undefined
            ? Option.none<string>()
            : Option.some(precedent.note),
      }),
  },
);

export const precedentRow: (
  precedent: Library.Precedent,
) => typeof PrecedentRow.insert.Encoded = (precedent) =>
  Schema.encodeSync(PrecedentFromRow)(precedent);
