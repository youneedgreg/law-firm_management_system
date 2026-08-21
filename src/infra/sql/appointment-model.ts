import { Model } from "@effect/sql";
import { Option, ParseResult, Schema } from "effect";
import * as Diary from "../../domain/diary/appointment";
import {
  AdvocateId,
  AppointmentId,
  CaseId,
  ClientId,
} from "../../domain/shared/ids";

/**
 * The `appointments` table.
 *
 * Almost one-to-one, like the firm-records models and unlike `message-model`
 * next door: there is no union to flatten and no invariant spread across
 * columns, so the only work is `Option` handling and the optional `location`
 * that the domain spells as absence and the row spells as null.
 */
export class AppointmentRow extends Model.Class<AppointmentRow>(
  "AppointmentRow",
)({
  id: AppointmentId,
  title: Schema.NonEmptyTrimmedString,
  type: Diary.Type,
  advocateId: AdvocateId,
  clientId: Model.FieldOption(ClientId),
  caseId: Model.FieldOption(CaseId),
  startsAt: Schema.DateFromSelf,
  minutes: Schema.Int.pipe(Schema.positive()),
  location: Model.FieldOption(Schema.NonEmptyTrimmedString),
}) {}

export const AppointmentFromRow = Schema.transformOrFail(
  AppointmentRow.insert,
  Schema.typeSchema(Diary.Appointment),
  {
    strict: true,

    decode: (row) => {
      const location = row.location;
      return ParseResult.succeed({
        id: row.id,
        title: row.title,
        type: row.type,
        advocateId: row.advocateId,
        clientId: row.clientId,
        caseId: row.caseId,
        startsAt: row.startsAt,
        minutes: row.minutes,
        ...(location._tag === "Some" ? { location: location.value } : {}),
      });
    },

    encode: (appointment) =>
      ParseResult.succeed({
        id: appointment.id,
        title: appointment.title,
        type: appointment.type,
        advocateId: appointment.advocateId,
        clientId: appointment.clientId,
        caseId: appointment.caseId,
        startsAt: appointment.startsAt,
        minutes: appointment.minutes,
        location:
          appointment.location === undefined
            ? Option.none<string>()
            : Option.some(appointment.location),
      }),
  },
);

export const appointmentRow: (
  appointment: Diary.Appointment,
) => typeof AppointmentRow.insert.Encoded = (appointment) =>
  Schema.encodeSync(AppointmentFromRow)(appointment);
