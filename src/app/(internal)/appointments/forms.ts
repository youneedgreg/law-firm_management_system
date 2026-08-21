import { Schema } from "effect";
import * as Diary from "@/domain/diary/appointment";
import { AdvocateId, CaseId, ClientId } from "@/domain/shared/ids";
import type { ScheduleAppointment } from "@/services/appointment-service";

/**
 * The boundary between the booking form and the domain.
 *
 * **A date and a time become an instant**, exactly as a court listing does, and
 * for the same reason: an appointment is a moment. Composed as UTC to match
 * every other date this system writes; a real Nairobi deployment would want
 * `Africa/Nairobi` here and in the listing form, in those two places and no
 * others.
 *
 * **A length, not an end time.** The form asks how long it runs, because that
 * is the question somebody booking a meeting can answer, and because a stored
 * start and end are two facts that can disagree the moment one is edited.
 *
 * **Empty selects become `Option.none`.** An internal meeting has no client and
 * no matter, and `""` from an unfilled `<select>` is not a client id — it is
 * the absence of one, and `OptionFromNullishOr` is where that becomes true.
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
 * How long a meeting runs, from a `<select>`.
 *
 * A select rather than a number field. Free minutes invites `0`, `-30` and
 * `480`, and the domain refuses the first two while accepting the third — a
 * meeting is not eight hours long, and the input that let somebody type it is
 * the input at fault.
 */
export const LENGTHS = [
  { value: "30", label: "30 minutes" },
  { value: "45", label: "45 minutes" },
  { value: "60", label: "1 hour" },
  { value: "90", label: "1½ hours" },
  { value: "120", label: "2 hours" },
] as const;

const Booked = Schema.Struct({
  title: Schema.NonEmptyTrimmedString,
  type: Diary.Type,
  advocateId: AdvocateId,
  clientId: Schema.optional(ClientId),
  caseId: Schema.optional(CaseId),
  startsOn: Day,
  startsAt: Clock,
  minutes: Schema.NumberFromString.pipe(Schema.int(), Schema.positive()),
  location: Schema.optional(Schema.NonEmptyTrimmedString),
});

export const ScheduleAppointmentForm = Schema.transform(
  Booked,
  Schema.typeSchema(
    Schema.Struct({
      title: Schema.NonEmptyTrimmedString,
      type: Diary.Type,
      advocateId: AdvocateId,
      clientId: Schema.OptionFromSelf(ClientId),
      caseId: Schema.OptionFromSelf(CaseId),
      startsAt: Schema.DateFromSelf,
      minutes: Schema.Number,
      location: Schema.optional(Schema.NonEmptyTrimmedString),
    }),
  ),
  {
    strict: false,
    decode: (form) => ({
      title: form.title,
      type: form.type,
      advocateId: form.advocateId,
      clientId: Schema.decodeSync(Schema.OptionFromNullishOr(ClientId, null))(
        form.clientId ?? null,
      ),
      caseId: Schema.decodeSync(Schema.OptionFromNullishOr(CaseId, null))(
        form.caseId ?? null,
      ),
      startsAt: new Date(`${form.startsOn}T${form.startsAt}:00.000Z`),
      minutes: form.minutes,
      ...(form.location === undefined ? {} : { location: form.location }),
    }),
    encode: () => {
      throw new Error("ScheduleAppointmentForm is decode-only");
    },
  },
);

export const asBooking = (
  form: typeof ScheduleAppointmentForm.Type,
): ScheduleAppointment => form as ScheduleAppointment;
