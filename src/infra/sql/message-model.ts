import { Model } from "@effect/sql";
import { Option, ParseResult, Schema } from "effect";
import * as Correspondence from "../../domain/message/message";
import {
  AdvocateId,
  CaseId,
  ClientId,
  MessageId,
} from "../../domain/shared/ids";

/**
 * The `messages` table, and the bridge to a `Message`.
 *
 * One disagreement, and it is the tagged union. The domain has an `Author` that
 * is either `FromClient` (carrying nothing) or `FromFirm` (carrying an
 * advocate); the table has an enum column and a nullable id constrained to
 * agree by `author_is_consistent`.
 *
 * This mapping refuses the combinations that constraint forbids rather than
 * trusting it. A `FromFirm` handed back with an undefined advocate would render
 * as "Sent by undefined" on a client's screen, which is worse than an error —
 * and the row a fix-up script writes is exactly the row that would do it.
 */
export class MessageRow extends Model.Class<MessageRow>("MessageRow")({
  id: MessageId,
  clientId: ClientId,
  caseId: Model.FieldOption(CaseId),
  author: Schema.Literal("FromClient", "FromFirm"),
  advocateId: Model.FieldOption(AdvocateId),
  body: Schema.NonEmptyTrimmedString,
  sentAt: Schema.DateFromSelf,
  readAt: Model.FieldOption(Schema.DateFromSelf),
}) {}

/** The author, as two columns. Exhaustive by construction. */
const flattenAuthor = (
  author: Correspondence.Author,
): {
  readonly author: "FromClient" | "FromFirm";
  readonly advocateId: Option.Option<AdvocateId>;
} => {
  switch (author._tag) {
    case "FromClient":
      return { author: "FromClient", advocateId: Option.none() };
    case "FromFirm":
      return {
        author: "FromFirm",
        advocateId: Option.some(author.advocateId),
      };
  }
};

export const MessageFromRow = Schema.transformOrFail(
  MessageRow.insert,
  Schema.typeSchema(Correspondence.Message),
  {
    strict: true,

    decode: (row, _options, ast) => {
      const advocateId = Option.getOrUndefined(row.advocateId);

      if (row.author === "FromFirm" && advocateId === undefined) {
        return ParseResult.fail(
          new ParseResult.Type(
            ast,
            row,
            "the row says the firm sent this and does not say who",
          ),
        );
      }

      if (row.author === "FromClient" && advocateId !== undefined) {
        return ParseResult.fail(
          new ParseResult.Type(
            ast,
            row,
            "the row says a client sent this and names an advocate",
          ),
        );
      }

      return ParseResult.succeed({
        id: row.id,
        clientId: row.clientId,
        caseId: row.caseId,
        author:
          advocateId === undefined
            ? ({ _tag: "FromClient" } as const)
            : ({ _tag: "FromFirm", advocateId } as const),
        body: row.body,
        sentAt: row.sentAt,
        readAt: row.readAt,
      });
    },

    encode: (message) =>
      ParseResult.succeed({
        id: message.id,
        clientId: message.clientId,
        caseId: message.caseId,
        body: message.body,
        sentAt: message.sentAt,
        readAt: message.readAt,
        ...flattenAuthor(message.author),
      }),
  },
);

/**
 * A message, encoded for `sql.insert`.
 *
 * The same shape `taskRow` and `paymentRow` exist for: the Model's *decoded*
 * insert type carries `Option`s and `Date`s, which `sql.insert` cannot
 * serialise.
 */
export const messageRow: (
  message: Correspondence.Message,
) => typeof MessageRow.insert.Encoded = (message) =>
  Schema.encodeSync(MessageFromRow)(message);
