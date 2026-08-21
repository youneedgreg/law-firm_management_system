import { SqlClient, SqlSchema } from "@effect/sql";
import { Effect, Layer, Schema } from "effect";
import type * as Diary from "../../domain/diary/appointment";
import { AdvocateId } from "../../domain/shared/ids";
import {
  AppointmentRepository,
  type RepositoryFailure,
} from "../../services/repositories";
import { AppointmentFromRow, appointmentRow } from "./appointment-model";
import { failure } from "./failure";

/**
 * Appointments, in Postgres.
 *
 * `forAdvocateOn` is the read the clash check needs and the diary view uses —
 * one advocate, one day, shaped to `appointments_by_advocate`. It is a day
 * rather than an arbitrary range because that is what both callers want, and a
 * range parameter nobody passes anything but a day to is a parameter that
 * eventually gets passed something else.
 */
export const AppointmentRepositoryLive = Layer.effect(
  AppointmentRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const upcoming = SqlSchema.findAll({
      Request: Schema.Void,
      Result: AppointmentFromRow,
      execute: () => sql`
        SELECT * FROM appointments
         WHERE starts_at + make_interval(mins => minutes) >= now()
         ORDER BY starts_at
      `,
    });

    const forAdvocateOn = SqlSchema.findAll({
      Request: Schema.Struct({
        advocateId: AdvocateId,
        day: Schema.DateFromSelf,
      }),
      Result: AppointmentFromRow,
      execute: ({ advocateId, day }) => sql`
        SELECT * FROM appointments
         WHERE advocate_id = ${advocateId}
           AND starts_at >= date_trunc('day', ${day}::timestamptz)
           AND starts_at <  date_trunc('day', ${day}::timestamptz) + interval '1 day'
         ORDER BY starts_at
      `,
    });

    return AppointmentRepository.of({
      upcoming: () => upcoming().pipe(Effect.mapError(failure("upcoming"))),

      forAdvocateOn: (advocateId, day) =>
        forAdvocateOn({ advocateId, day }).pipe(
          Effect.mapError(failure("forAdvocateOn")),
        ),

      save: (appointment) =>
        Effect.sync(() => appointmentRow(appointment)).pipe(
          Effect.flatMap(
            (row) => sql`
              INSERT INTO appointments ${sql.insert(row)}
              ON CONFLICT (id) DO UPDATE SET ${sql.update(row, ["id"])}
            `,
          ),
          Effect.as(appointment),
          Effect.mapError(failure("save")),
        ) satisfies Effect.Effect<Diary.Appointment, RepositoryFailure>,
    });
  }),
);
