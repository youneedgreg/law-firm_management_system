import { Option, Schema } from "effect";
import * as Log from "@/domain/firm/contact";
import { CaseId, ClientId } from "@/domain/shared/ids";
import type { LogContact } from "@/services/library-service";

/**
 * The boundary between the contact form and the service.
 *
 * The same two conversions every form in this system makes — an empty select
 * means "no matter", and a `yyyy-mm-dd` becomes midnight *UTC* rather than
 * local midnight, which is how a date moves a day for anyone east of Greenwich.
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

const DayInput = Schema.transform(
  Schema.String.pipe(Schema.pattern(/^\d{4}-\d{2}-\d{2}$/)),
  Schema.DateFromSelf,
  {
    strict: true,
    decode: (day) => new Date(`${day}T00:00:00.000Z`),
    encode: (date) => date.toISOString().slice(0, 10),
  },
).annotations({ identifier: "DayInput" });

export const LogContactForm = Schema.Struct({
  clientId: ClientId,
  /** Absent when the select submitted nothing — a general conversation. */
  caseId: Schema.optional(CaseId),
  channel: Log.Channel,
  direction: Log.Direction,
  summary: Schema.NonEmptyTrimmedString,
  occurredOn: DayInput,
});

export type LogContactForm = typeof LogContactForm.Type;

export const asLogContact = (form: LogContactForm): LogContact => ({
  clientId: form.clientId,
  caseId: Option.fromNullable(form.caseId),
  channel: form.channel,
  direction: form.direction,
  summary: form.summary,
  occurredOn: form.occurredOn,
});

/** The value the "no matter" option submits. */
export const NO_MATTER = "";
