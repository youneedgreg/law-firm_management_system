import { DateTime, Effect, Option, Schema } from "effect";
import * as Diary from "../domain/diary/appointment";
import type { NotPermitted } from "../domain/identity/permissions";
import {
  AdvocateId,
  AppointmentId,
  CaseId,
  ClientId,
} from "../domain/shared/ids";
import { type CurrentUser, permitted } from "./policy";
import {
  AdvocateRepository,
  AppointmentRepository,
  CaseRepository,
  ClientRepository,
  HearingRepository,
  type NotFound,
  type RepositoryFailure,
} from "./repositories";

/**
 * The appointment diary.
 *
 * ## The clash check reads the court diary too
 *
 * This is the whole reason the module is worth having. An advocate cannot be
 * in two places at once, and the booking that actually goes wrong is a
 * consultation at ten o'clock on a morning somebody is already in court — the
 * court date was set weeks earlier by somebody else, the receptionist taking
 * the call cannot see it, and the client arrives to an empty office.
 *
 * So `schedule` reads **both** the advocate's appointments and their hearings
 * for that day, and refuses an overlap with either. A check that only knew
 * about appointments would miss the one clash that matters most, and would
 * miss it silently.
 *
 * A hearing has no end time — courts do not publish one — so it is treated as
 * occupying `HEARING_MINUTES`. That is an assumption and is stated as one: it
 * is generous rather than precise, on the grounds that a false clash costs a
 * conversation and a missed one costs a client.
 *
 * ## Refused, not warned
 *
 * The same reasoning as closing a matter over open work. A warning is
 * dismissed and the booking is still wrong; the remedy — pick another time, or
 * another advocate — takes seconds and has to happen anyway.
 */

export interface DiaryEntry {
  readonly appointment: Diary.Appointment;
  readonly advocateName: string;
  readonly clientName: Option.Option<string>;
  readonly matterNumber: Option.Option<string>;
}

/** Who an appointment can be booked with, and against what. */
export interface DiaryChoices {
  readonly staff: readonly {
    readonly id: AdvocateId;
    readonly name: string;
  }[];
  readonly clients: readonly {
    readonly id: ClientId;
    readonly name: string;
  }[];
  readonly matters: readonly {
    readonly id: CaseId;
    readonly clientId: ClientId;
    readonly number: string;
    readonly title: string;
  }[];
}

export const ScheduleAppointment = Schema.Struct({
  title: Schema.NonEmptyTrimmedString,
  type: Diary.Type,
  advocateId: AdvocateId,
  clientId: Schema.OptionFromNullishOr(ClientId, null),
  caseId: Schema.OptionFromNullishOr(CaseId, null),
  startsAt: Schema.Date,
  minutes: Schema.Int.pipe(Schema.positive()),
  location: Schema.optional(Schema.NonEmptyTrimmedString),
});

export type ScheduleAppointment = typeof ScheduleAppointment.Type;

export type CannotSchedule =
  NotPermitted | NotFound | Diary.DiaryClash | RepositoryFailure;

const appointmentId = (): AppointmentId =>
  Schema.decodeSync(AppointmentId)(crypto.randomUUID());

export class AppointmentService extends Effect.Service<AppointmentService>()(
  "AppointmentService",
  {
    effect: Effect.gen(function* () {
      const appointments = yield* AppointmentRepository;
      const hearings = yield* HearingRepository;
      const advocates = yield* AdvocateRepository;
      const clients = yield* ClientRepository;
      const cases = yield* CaseRepository;

      /**
       * Everything already occupying one advocate's day — appointments *and*
       * court dates, as one list of spans.
       *
       * The two sources are unified into `Busy` here rather than in the domain,
       * because turning a hearing into a span requires an assumption about how
       * long it runs and that assumption belongs where it can be seen.
       */
      const committed = (advocateId: AdvocateId, day: Date) =>
        Effect.gen(function* () {
          const [booked, listed, everyMatter] = yield* Effect.all(
            [
              appointments.forAdvocateOn(advocateId, day),
              hearings.pending(),
              cases.all(),
            ],
            { concurrency: "unbounded" },
          );

          const numbers = new Map(
            everyMatter.map((matter) => [matter.id, matter.number]),
          );

          const sameDay = (at: Date) =>
            at.toISOString().slice(0, 10) === day.toISOString().slice(0, 10);

          const inCourt = listed
            .filter(
              (hearing) =>
                hearing.advocateId === advocateId &&
                sameDay(hearing.scheduledFor),
            )
            .map((hearing) =>
              Diary.asBusy(
                advocateId,
                hearing.scheduledFor,
                Diary.HEARING_MINUTES,
                `${hearing.kind} · ${numbers.get(hearing.caseId) ?? "a matter"}`,
              ),
            );

          return [...booked.map(Diary.occupies), ...inCourt];
        });

      /** Names for a batch of appointments, resolved once. */
      const described = (
        list: readonly Diary.Appointment[],
      ): Effect.Effect<readonly DiaryEntry[], RepositoryFailure, CurrentUser> =>
        Effect.gen(function* () {
          const [everyAdvocate, everyClient, everyMatter] = yield* Effect.all(
            [advocates.all(), clients.all(), cases.all()],
            { concurrency: "unbounded" },
          );

          const staff = new Map(
            everyAdvocate.map((advocate) => [advocate.id, advocate.name]),
          );
          const names = new Map(
            everyClient.map((client) => [client.id, client.name]),
          );
          const numbers = new Map(
            everyMatter.map((matter) => [matter.id, matter.number]),
          );

          return list.map((appointment): DiaryEntry => ({
            appointment,
            advocateName: staff.get(appointment.advocateId) ?? "Unassigned",
            clientName: Option.flatMap(appointment.clientId, (id) =>
              Option.fromNullable(names.get(id)),
            ),
            matterNumber: Option.flatMap(appointment.caseId, (id) =>
              Option.fromNullable(numbers.get(id)),
            ),
          }));
        });

      return {
        /**
         * What is coming up, soonest first.
         *
         * Firm-wide and staff-only, and `staff:read` is doing both jobs: no
         * portal user holds it, so a client is refused rather than shown an
         * empty diary. There is deliberately no scope check underneath — every
         * principal that gets past the permission is `WholeFirm`, and a second
         * narrowing here would be a branch no test could reach, which is how a
         * file acquires a safety check that has never once run.
         *
         * A client seeing their own appointments is a reasonable feature and a
         * different one: it needs a decision about whether they may see who
         * else their advocate is meeting that day, which this list would answer
         * by accident.
         */
        upcoming: (): Effect.Effect<
          readonly DiaryEntry[],
          NotPermitted | RepositoryFailure,
          CurrentUser
        > =>
          Effect.gen(function* () {
            yield* permitted("staff:read");

            const [booked, now] = yield* Effect.all([
              appointments.upcoming(),
              DateTime.nowAsDate,
            ]);

            return yield* described(Diary.upcoming(booked, now));
          }),

        choices: (): Effect.Effect<
          DiaryChoices,
          NotPermitted | RepositoryFailure,
          CurrentUser
        > =>
          Effect.gen(function* () {
            yield* permitted("hearing:write");

            const [everyAdvocate, everyClient, openMatters] = yield* Effect.all(
              [advocates.all(), clients.all(), cases.openMatters()],
              { concurrency: "unbounded" },
            );

            return {
              staff: everyAdvocate
                .filter((advocate) => advocate.active)
                .map((advocate) => ({ id: advocate.id, name: advocate.name }))
                .sort((a, b) => a.name.localeCompare(b.name)),
              clients: everyClient
                .map((client) => ({ id: client.id, name: client.name }))
                .sort((a, b) => a.name.localeCompare(b.name)),
              matters: openMatters
                .map((matter) => ({
                  id: matter.id,
                  clientId: matter.clientId,
                  number: matter.number,
                  title: matter.title,
                }))
                .sort((a, b) => a.number.localeCompare(b.number)),
            };
          }),

        /**
         * Books an appointment, refusing a clash.
         *
         * Gated on `hearing:write` rather than a permission of its own. That is
         * a judgement worth stating: booking a client meeting and listing a
         * court date are the same act of putting something in somebody's diary,
         * performed by the same people, and a separate `appointment:write` held
         * by exactly the roles that already hold `hearing:write` would be a
         * distinction with no difference — one more row in a table whose value
         * is that every row means something.
         */
        schedule: (
          input: ScheduleAppointment,
        ): Effect.Effect<Diary.Appointment, CannotSchedule, CurrentUser> =>
          Effect.gen(function* () {
            yield* permitted("hearing:write");

            const advocate = yield* advocates.byId(input.advocateId);

            const proposed = Diary.asBusy(
              input.advocateId,
              input.startsAt,
              input.minutes,
              input.title,
            );

            const clashes = Diary.clashesWith(
              proposed,
              yield* committed(input.advocateId, input.startsAt),
            );

            if (clashes.length > 0) {
              return yield* Effect.fail(
                new Diary.DiaryClash({
                  advocate: advocate.name,
                  against: clashes.map((busy) => busy.what),
                  at: input.startsAt,
                }),
              );
            }

            const appointment: Diary.Appointment = {
              id: appointmentId(),
              title: input.title,
              type: input.type,
              advocateId: input.advocateId,
              clientId: input.clientId,
              caseId: input.caseId,
              startsAt: input.startsAt,
              minutes: input.minutes,
              ...(input.location === undefined
                ? {}
                : { location: input.location }),
            };

            /**
             * No audit entry, and that is deliberate rather than an omission.
             *
             * The trail records acts with consequences outside this system —
             * money moved, a document filed, a message sent to a client. A
             * diary entry is an arrangement between people that they will
             * change by telephone, and recording every booking would bury the
             * entries somebody will one day need to find. If an appointment
             * ever becomes evidence — a missed meeting in a negligence claim —
             * that is the moment to add it, and the argument will be about the
             * meeting rather than about the row.
             */
            return yield* appointments.save(appointment);
          }),
      };
    }),
  },
) {}
