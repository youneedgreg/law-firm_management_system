import { Effect, ParseResult, Schema } from "effect";
import * as Hearing from "@/domain/court/hearing";
import { AdvocateId, CaseId, HearingId } from "@/domain/shared/ids";
import type { ListHearing, RecordOutcome } from "@/services/hearing-service";
import { CourtFromKey } from "../cases/forms";

/**
 * The boundary between the diary forms and the domain.
 *
 * Two conversions, and the second is the one that carries the module's whole
 * argument.
 *
 * **A date and a time become an instant.** A hearing is a moment, not a day —
 * "9:00 on the 4th" is what the court listed, and a diary that stored only the
 * day could not tell an advocate whether they can be in two courts on the same
 * morning.
 *
 * **An outcome becomes a tagged union.** The form submits a flat
 * `outcome` / `adjournedTo` / `reason`, because that is what a `<form>` can
 * carry. The domain refuses an `Adjourned` with no destination, and this is
 * where the flat submission either becomes a legal `Outcome` or is refused with
 * the message against the field that is missing.
 */

export const submitted = (form: FormData): Record<string, string> => {
  const fields: Record<string, string> = {};
  for (const [name, value] of form.entries()) {
    if (typeof value === "string" && value.trim() !== "") {
      fields[name] = value;
    }
  }
  return fields;
};

const Day = Schema.String.pipe(Schema.pattern(/^\d{4}-\d{2}-\d{2}$/));
const Clock = Schema.String.pipe(Schema.pattern(/^([01]\d|2[0-3]):[0-5]\d$/));

/**
 * A listing, from a date and a time.
 *
 * Composed as UTC, matching every other date this system writes. Nairobi is
 * UTC+3 with no daylight saving, so a real deployment would want
 * `Africa/Nairobi` here and in the seed — and would want it in exactly one
 * place, which is why the composition is a named schema rather than a
 * `new Date` at each call site.
 */
const Listed = Schema.Struct({
  caseId: CaseId,
  kind: Hearing.HearingKind,
  court: CourtFromKey,
  room: Schema.optional(Schema.NonEmptyTrimmedString),
  scheduledOn: Day,
  scheduledAt: Clock,
  advocateId: AdvocateId,
});

export const ListHearingForm = Schema.transform(
  Listed,
  Schema.typeSchema(
    Schema.Struct({
      caseId: CaseId,
      kind: Hearing.HearingKind,
      court: Schema.Any,
      room: Schema.optional(Schema.NonEmptyTrimmedString),
      scheduledFor: Schema.DateFromSelf,
      advocateId: AdvocateId,
    }),
  ),
  {
    strict: false,
    decode: (form) => ({
      caseId: form.caseId,
      kind: form.kind,
      court: form.court,
      ...(form.room === undefined ? {} : { room: form.room }),
      scheduledFor: new Date(`${form.scheduledOn}T${form.scheduledAt}:00.000Z`),
      advocateId: form.advocateId,
    }),
    encode: () => {
      throw new Error("ListHearingForm is decode-only");
    },
  },
);

export const asListing = (form: typeof ListHearingForm.Type): ListHearing =>
  form as ListHearing;

/**
 * An outcome, from a flat submission.
 *
 * The refusal is placed on `adjournedOn`, because that is the input somebody
 * has to go back and fill in. A message at the bottom of the form saying "an
 * adjournment needs a date" is true and useless.
 */
const Submitted = Schema.Struct({
  outcome: Schema.Literal("Heard", "Adjourned", "NotReached", "Withdrawn"),
  note: Schema.optional(Schema.String),
  adjournedOn: Schema.optional(Day),
  adjournedAt: Schema.optional(Clock),
  reason: Schema.optional(Schema.NonEmptyTrimmedString),
});

export const RecordOutcomeForm = Schema.transformOrFail(
  Submitted,
  Schema.typeSchema(Schema.Struct({ outcome: Hearing.Outcome })),
  {
    strict: true,
    decode: (
      form: typeof Submitted.Type,
      _options,
      ast,
    ): Effect.Effect<
      { readonly outcome: Hearing.Outcome },
      ParseResult.ParseIssue
    > => {
      if (form.outcome !== "Adjourned") {
        return ParseResult.succeed({
          outcome: Hearing.Outcome.members[
            form.outcome === "Heard" ? 0 : form.outcome === "NotReached" ? 2 : 3
          ].make(form.note === undefined ? {} : { note: form.note }),
        });
      }

      if (
        form.adjournedOn === undefined ||
        form.adjournedAt === undefined ||
        form.reason === undefined
      ) {
        return ParseResult.fail(
          new ParseResult.Type(
            ast,
            form,
            "An adjournment must say where the matter went and why. A matter " +
              "adjourned with no next date is one that has quietly fallen off " +
              "the diary",
          ),
        );
      }

      return ParseResult.succeed({
        outcome: Hearing.Outcome.members[1].make({
          adjournedTo: new Date(
            `${form.adjournedOn}T${form.adjournedAt}:00.000Z`,
          ),
          reason: form.reason,
        }),
      });
    },

    encode: (recorded, _options, ast) =>
      ParseResult.fail(
        new ParseResult.Forbidden(
          ast,
          recorded,
          "RecordOutcomeForm is decode-only",
        ),
      ),
  },
);

export const asOutcome = (form: typeof RecordOutcomeForm.Type): RecordOutcome =>
  form;

export const hearingIdOf = (id: string) =>
  Schema.decodeUnknownEither(HearingId)(id);
