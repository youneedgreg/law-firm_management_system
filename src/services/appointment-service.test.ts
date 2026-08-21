import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Schema, TestClock } from "effect";
import {
  advocates,
  asAdvocate,
  asReceptionist,
  asWanjiku,
  clients,
  courtDates,
  filedMatter,
  matters,
  sarah,
  upcomingHearing,
  wanjiku,
} from "../../test/fixtures";
import {
  appointmentsWithStore,
  inMemoryAdvocates,
  inMemoryCases,
  inMemoryClients,
  inMemoryHearings,
} from "../../test/in-memory-repositories";
import type * as Diary from "../domain/diary/appointment";
import { HEARING_MINUTES } from "../domain/diary/appointment";
import type { Principal } from "../domain/identity/principal";
import { AdvocateId, AppointmentId } from "../domain/shared/ids";
import {
  AppointmentService,
  type ScheduleAppointment,
} from "./appointment-service";
import { CurrentUser } from "./policy";

/**
 * `AppointmentService`, and the rule that earns appointments a table.
 *
 * An advocate cannot be in two places at once. The booking that actually goes
 * wrong is a consultation on a morning somebody is already in court — the court
 * date was set weeks earlier by somebody else, and whoever answers the
 * telephone cannot see it. So the clash check reads **both** diaries, and the
 * tests below are written so that a version reading only appointments fails.
 */

const day = (time: string) => new Date(`2026-09-04T${time}:00.000Z`);

/** The morning Sarah is already in court: `upcomingHearing`, 06:00Z. */
const inCourtAt = upcomingHearing.scheduledFor;

const diary = (seed: readonly Diary.Appointment[] = []) => {
  const { layer, store } = appointmentsWithStore(seed);

  return {
    store,
    layer: AppointmentService.Default.pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          layer,
          inMemoryHearings(courtDates),
          inMemoryAdvocates(advocates),
          inMemoryClients(clients),
          inMemoryCases(matters),
        ),
      ),
    ),
  };
};

const booking = (
  fields: Partial<ScheduleAppointment> = {},
): ScheduleAppointment => ({
  title: "Consultation — settlement terms",
  type: "Client consultation",
  advocateId: sarah.id,
  clientId: Option.some(wanjiku.id),
  caseId: Option.some(filedMatter.id),
  startsAt: day("12:00"),
  minutes: 60,
  ...fields,
});

const scheduleAs = (principal: Principal, input: ScheduleAppointment) =>
  Effect.flatMap(AppointmentService, (service) => service.schedule(input)).pipe(
    Effect.provideService(CurrentUser, principal),
  );

const upcomingAs = (principal: Principal) =>
  Effect.flatMap(AppointmentService, (service) => service.upcoming()).pipe(
    Effect.provideService(CurrentUser, principal),
  );

describe("booking against the court diary", () => {
  /**
   * **The test this module exists to pass.**
   *
   * The advocate's appointment diary is empty. She is still in court, and the
   * booking must be refused. A clash check that read only `appointments` would
   * accept this and the client would arrive to an empty office.
   */
  it.effect("refuses a meeting on a morning already spent in court", () => {
    const { layer } = diary();

    return Effect.gen(function* () {
      const outcome = yield* Effect.flip(
        scheduleAs(asAdvocate, booking({ startsAt: inCourtAt })),
      );

      expect(outcome._tag).toBe("DiaryClash");
    }).pipe(Effect.provide(layer));
  });

  /** And says what the collision was, so the answer is actionable. */
  it.effect("names the court date it clashed with", () => {
    const { layer } = diary();

    return Effect.gen(function* () {
      const outcome = yield* Effect.flip(
        scheduleAs(asAdvocate, booking({ startsAt: inCourtAt })),
      );

      expect(outcome._tag).toBe("DiaryClash");
      if (outcome._tag !== "DiaryClash") return;

      expect(outcome.advocate).toBe(sarah.name);
      expect(outcome.against.join(" ")).toContain(filedMatter.number);
    }).pipe(Effect.provide(layer));
  });

  /**
   * A hearing is assumed to run `HEARING_MINUTES`, so the afternoon of a
   * morning hearing is free. Booking just past the assumed end must succeed —
   * otherwise the assumption is not an assumption but a whole-day block.
   */
  it.effect("leaves the rest of the day free", () => {
    const { layer } = diary();

    return Effect.gen(function* () {
      const after = new Date(
        inCourtAt.getTime() + (HEARING_MINUTES + 1) * 60_000,
      );

      const booked = yield* scheduleAs(
        asAdvocate,
        booking({ startsAt: after }),
      );

      expect(booked.startsAt).toStrictEqual(after);
    }).pipe(Effect.provide(layer));
  });

  /**
   * A hearing with an outcome already recorded is finished — the advocate
   * walked out of court. `pending()` excludes it, and this asserts the service
   * uses that rather than `all()`, which would block time already spent.
   */
  it.effect("ignores a hearing that has already been recorded", () => {
    const { layer } = diary();

    return Effect.gen(function* () {
      const recorded = courtDates.find(
        (hearing) => hearing.outcome !== undefined,
      );
      expect(recorded).toBeDefined();

      const booked = yield* scheduleAs(
        asAdvocate,
        booking({
          advocateId: recorded!.advocateId,
          startsAt: recorded!.scheduledFor,
        }),
      );

      expect(booked.id).toBeDefined();
    }).pipe(Effect.provide(layer));
  });

  /** Somebody else's court date is not this advocate's problem. */
  it.effect("does not block on another advocate's hearing", () => {
    const { layer } = diary();

    return Effect.gen(function* () {
      const other = advocates.find(
        (advocate) => advocate.id !== upcomingHearing.advocateId,
      );
      expect(other).toBeDefined();

      const booked = yield* scheduleAs(
        asAdvocate,
        booking({ advocateId: other!.id, startsAt: inCourtAt }),
      );

      expect(booked.advocateId).toBe(other!.id);
    }).pipe(Effect.provide(layer));
  });
});

describe("booking against the appointment diary", () => {
  it.effect("refuses an overlapping appointment", () => {
    const existing = anAppointment(1, day("12:00"), 60);
    const { layer } = diary([existing]);

    return Effect.gen(function* () {
      const outcome = yield* Effect.flip(
        scheduleAs(asAdvocate, booking({ startsAt: day("12:30") })),
      );

      expect(outcome._tag).toBe("DiaryClash");
    }).pipe(Effect.provide(layer));
  });

  /**
   * Back-to-back consultations are normal, and a system that refused them
   * would be turned off within a week.
   */
  it.effect("allows a booking that starts as another ends", () => {
    const { layer, store } = diary([anAppointment(1, day("12:00"), 60)]);

    return Effect.gen(function* () {
      yield* scheduleAs(asAdvocate, booking({ startsAt: day("13:00") }));

      expect(yield* store.get).toHaveLength(2);
    }).pipe(Effect.provide(layer));
  });

  /** A clash is a refusal, so nothing is written. */
  it.effect("writes nothing when it refuses", () => {
    const { layer, store } = diary([anAppointment(1, day("12:00"), 60)]);

    return Effect.gen(function* () {
      yield* Effect.flip(
        scheduleAs(asAdvocate, booking({ startsAt: day("12:30") })),
      );

      expect(yield* store.get).toHaveLength(1);
    }).pipe(Effect.provide(layer));
  });

  it.effect("stores what it was given", () => {
    const { layer } = diary();

    return Effect.gen(function* () {
      const booked = yield* scheduleAs(
        asAdvocate,
        booking({ title: "Site visit — Ngong Road", type: "Site visit" }),
      );

      expect(booked.title).toBe("Site visit — Ngong Road");
      expect(booked.type).toBe("Site visit");
      expect(booked.minutes).toBe(60);
    }).pipe(Effect.provide(layer));
  });

  /** Not every appointment is with a client — an internal meeting has none. */
  it.effect("accepts an appointment with no client and no matter", () => {
    const { layer } = diary();

    return Effect.gen(function* () {
      const booked = yield* scheduleAs(
        asAdvocate,
        booking({
          type: "Internal meeting",
          clientId: Option.none(),
          caseId: Option.none(),
        }),
      );

      expect(Option.isNone(booked.clientId)).toBe(true);
    }).pipe(Effect.provide(layer));
  });
});

describe("who may book", () => {
  /**
   * Gated on `hearing:write`, the permission for putting something in
   * somebody's diary. A Receptionist holds neither, and takes the call — which
   * is a real workflow question and a deliberate answer: they write it down and
   * somebody with the permission enters it. If that proves wrong in practice
   * the fix is to grant `hearing:write` to the role, not to leave the endpoint
   * open.
   */
  it.effect("refuses a Receptionist", () => {
    const { layer } = diary();

    return Effect.gen(function* () {
      const outcome = yield* Effect.flip(scheduleAs(asReceptionist, booking()));

      expect(outcome._tag).toBe("NotPermitted");
    }).pipe(Effect.provide(layer));
  });

  it.effect("refuses a portal user", () => {
    const { layer } = diary();

    return Effect.gen(function* () {
      const outcome = yield* Effect.flip(scheduleAs(asWanjiku, booking()));

      expect(outcome._tag).toBe("NotPermitted");
    }).pipe(Effect.provide(layer));
  });

  /** An advocate who does not exist cannot be booked. */
  it.effect("refuses an unknown advocate", () => {
    const { layer } = diary();

    return Effect.gen(function* () {
      const stranger = Schema.decodeSync(AdvocateId)(
        "10000000-0000-4000-8000-0000000000ff",
      );

      const outcome = yield* Effect.flip(
        scheduleAs(asAdvocate, booking({ advocateId: stranger })),
      );

      expect(outcome._tag).toBe("NotFound");
    }).pipe(Effect.provide(layer));
  });
});

describe("the diary view", () => {
  it.effect("lists what has not happened yet, soonest first", () => {
    const { layer } = diary([
      anAppointment(1, day("16:00"), 60),
      anAppointment(2, day("09:00"), 60),
    ]);

    return Effect.gen(function* () {
      yield* TestClock.setTime(day("08:00").getTime());

      const entries = yield* upcomingAs(asAdvocate);

      expect(entries.map((entry) => entry.appointment.startsAt)).toStrictEqual([
        day("09:00"),
        day("16:00"),
      ]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("drops what is already over", () => {
    const { layer } = diary([anAppointment(1, day("09:00"), 60)]);

    return Effect.gen(function* () {
      yield* TestClock.setTime(day("11:00").getTime());

      expect(yield* upcomingAs(asAdvocate)).toStrictEqual([]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("names the advocate, the client and the matter", () => {
    const { layer } = diary([anAppointment(1, day("09:00"), 60)]);

    return Effect.gen(function* () {
      yield* TestClock.setTime(day("08:00").getTime());

      const entry = (yield* upcomingAs(asAdvocate))[0];
      expect(entry).toBeDefined();

      expect(entry?.advocateName).toBe(sarah.name);
      expect(Option.getOrNull(entry!.clientName)).toBe(wanjiku.name);
      expect(Option.getOrNull(entry!.matterNumber)).toBe(filedMatter.number);
    }).pipe(Effect.provide(layer));
  });

  /**
   * Firm-wide and staff-only, and **refused rather than emptied**.
   *
   * A client asking for the firm's diary is not asking for something that
   * happens to be empty for them — they are asking for something no client may
   * have, and `staff:read` says so. The distinction matters because an empty
   * list is the answer a broken scope filter also gives.
   *
   * Their own appointments are a reasonable feature and a different one: it
   * needs a decision about whether they may see who else their advocate is
   * meeting that day, which this list would answer by accident.
   */
  it.effect("refuses a portal user outright", () => {
    const { layer } = diary([anAppointment(1, day("09:00"), 60)]);

    return Effect.gen(function* () {
      yield* TestClock.setTime(day("08:00").getTime());

      const outcome = yield* Effect.flip(upcomingAs(asWanjiku));

      expect(outcome._tag).toBe("NotPermitted");
    }).pipe(Effect.provide(layer));
  });

  /** A Receptionist may read the diary even though they may not write to it. */
  it.effect("shows a Receptionist the diary", () => {
    const { layer } = diary([anAppointment(1, day("09:00"), 60)]);

    return Effect.gen(function* () {
      yield* TestClock.setTime(day("08:00").getTime());

      expect(yield* upcomingAs(asReceptionist)).toHaveLength(1);
    }).pipe(Effect.provide(layer));
  });
});

describe("what a booking can be made against", () => {
  it.effect("offers only advocates still at the firm", () => {
    const { layer } = diary();

    return Effect.gen(function* () {
      const choices = yield* Effect.flatMap(AppointmentService, (service) =>
        service.choices(),
      ).pipe(Effect.provideService(CurrentUser, asAdvocate));

      const offered = choices.staff.map((each) => each.id);
      const departed = advocates.filter((advocate) => !advocate.active);

      expect(departed.length).toBeGreaterThan(0);
      for (const advocate of departed) {
        expect(offered).not.toContain(advocate.id);
      }
    }).pipe(Effect.provide(layer));
  });

  it.effect("offers only open matters", () => {
    const { layer } = diary();

    return Effect.gen(function* () {
      const choices = yield* Effect.flatMap(AppointmentService, (service) =>
        service.choices(),
      ).pipe(Effect.provideService(CurrentUser, asAdvocate));

      const offered = choices.matters.map((each) => each.id);
      const closed = matters.filter((matter) => matter.status === "Closed");

      expect(closed.length).toBeGreaterThan(0);
      for (const matter of closed) {
        expect(offered).not.toContain(matter.id);
      }
    }).pipe(Effect.provide(layer));
  });
});

// ── helpers ───────────────────────────────────────────────────────────────

function anAppointment(
  n: number,
  startsAt: Date,
  minutes: number,
): Diary.Appointment {
  return {
    id: Schema.decodeSync(AppointmentId)(
      `a1000000-0000-4000-8000-00000000000${String(n)}`,
    ),
    title: `Appointment ${String(n)}`,
    type: "Client consultation",
    advocateId: sarah.id,
    clientId: Option.some(wanjiku.id),
    caseId: Option.some(filedMatter.id),
    startsAt,
    minutes,
  };
}
