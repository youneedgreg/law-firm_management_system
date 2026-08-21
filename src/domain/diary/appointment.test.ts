import { describe, expect, it } from "vitest";
import { Option, Schema } from "effect";
import { AdvocateId, AppointmentId, CaseId, ClientId } from "../shared/ids";
import {
  type Appointment,
  asBusy,
  type Busy,
  clashesWith,
  endsAt,
  HEARING_MINUTES,
  isClientFacing,
  occupies,
  onDay,
  upcoming,
} from "./appointment";

/**
 * Appointments, and the one rule that earns them a table.
 *
 * An advocate cannot be in two places at once, and the booking that actually
 * goes wrong is a consultation at ten o'clock on a morning somebody is already
 * in court — set weeks earlier by somebody else, invisible to whoever answers
 * the telephone. So the clash check is written against spans rather than
 * appointments, and a hearing is one of them.
 */

const advocate = Schema.decodeSync(AdvocateId)(
  "10000000-0000-4000-8000-000000000001",
);
const other = Schema.decodeSync(AdvocateId)(
  "10000000-0000-4000-8000-000000000002",
);
const client = Schema.decodeSync(ClientId)(
  "30000000-0000-4000-8000-000000000001",
);
const matter = Schema.decodeSync(CaseId)(
  "20000000-0000-4000-8000-000000000001",
);

const at = (iso: string) => new Date(`2026-08-20T${iso}:00.000Z`);

const appointment = (
  n: number,
  start: string,
  minutes = 60,
  fields: Partial<Appointment> = {},
): Appointment => ({
  id: Schema.decodeSync(AppointmentId)(
    `a1000000-0000-4000-8000-00000000000${n}`,
  ),
  title: `Appointment ${String(n)}`,
  type: "Client consultation",
  advocateId: advocate,
  clientId: Option.some(client),
  caseId: Option.some(matter),
  startsAt: at(start),
  minutes,
  ...fields,
});

describe("how long it runs", () => {
  /**
   * Minutes, not an end time. A start and an end are two facts that can
   * disagree the moment somebody edits one, and an appointment ending before
   * it begins is representable if both are stored.
   */
  it("derives the end from the start and the length", () => {
    expect(endsAt(appointment(1, "09:00", 90))).toStrictEqual(at("10:30"));
  });
});

describe("two places at once", () => {
  it("reports an overlap in the same diary", () => {
    const proposed = occupies(appointment(1, "09:30", 60));
    const existing = occupies(appointment(2, "09:00", 60));

    expect(clashesWith(proposed, [existing])).toHaveLength(1);
  });

  /**
   * **The boundary people actually book on.**
   *
   * One appointment ending at ten and another starting at ten do not clash —
   * back-to-back consultations are normal, and a system that refused them
   * would be turned off within a week. A naive `from <= other.to` gets this
   * wrong.
   */
  it("allows back-to-back bookings", () => {
    const first = occupies(appointment(1, "09:00", 60));
    const second = occupies(appointment(2, "10:00", 60));

    expect(clashesWith(second, [first])).toStrictEqual([]);
  });

  it("does not clash with somebody else's diary", () => {
    const mine = occupies(appointment(1, "09:00", 60));
    const theirs = occupies(appointment(2, "09:00", 60, { advocateId: other }));

    expect(clashesWith(mine, [theirs])).toStrictEqual([]);
  });

  /**
   * **The clash that matters most.** A court date was set weeks earlier by
   * somebody else, and the receptionist taking the call cannot see it. A check
   * that only knew about appointments would miss it entirely.
   */
  it("clashes with a court date", () => {
    const inCourt = asBusy(
      advocate,
      at("09:00"),
      HEARING_MINUTES,
      "Mention · OKL-2026-014",
    );
    const proposed = occupies(appointment(1, "10:00", 60));

    const found = clashesWith(proposed, [inCourt]);

    expect(found).toHaveLength(1);
    expect(found[0]?.what).toContain("OKL-2026-014");
  });

  /** Both, so "you are with a client and in court" is said once. */
  it("reports every collision rather than the first", () => {
    const inCourt = asBusy(advocate, at("09:00"), HEARING_MINUTES, "Mention");
    const meeting = occupies(appointment(2, "10:00", 60));
    const proposed = occupies(appointment(3, "10:15", 30));

    expect(clashesWith(proposed, [inCourt, meeting])).toHaveLength(2);
  });

  it("finds nothing in an empty diary", () => {
    expect(clashesWith(occupies(appointment(1, "09:00")), [])).toStrictEqual(
      [],
    );
  });

  /** Fully contained inside another commitment still collides. */
  it("catches an appointment nested inside a longer one", () => {
    const long: Busy = asBusy(advocate, at("09:00"), 240, "All-day hearing");
    const short = occupies(appointment(1, "11:00", 30));

    expect(clashesWith(short, [long])).toHaveLength(1);
  });
});

describe("the diary view", () => {
  it("lists what has not happened yet, soonest first", () => {
    const past = appointment(1, "08:00");
    const soon = appointment(2, "14:00");
    const later = appointment(3, "16:00");

    const list = upcoming([later, past, soon], at("10:00"));

    expect(list.map((each) => each.id)).toStrictEqual([soon.id, later.id]);
  });

  /**
   * An appointment currently under way is still "upcoming" for a diary — it
   * has not finished, and dropping it at the moment it starts is how somebody
   * loses the room number while walking to it.
   */
  it("keeps an appointment that is happening now", () => {
    const running = appointment(1, "09:30", 60);

    expect(upcoming([running], at("10:00"))).toHaveLength(1);
  });

  it("picks out one day", () => {
    const today = appointment(1, "09:00");
    const tomorrow: Appointment = {
      ...appointment(2, "09:00"),
      startsAt: new Date("2026-08-21T09:00:00.000Z"),
    };

    expect(onDay([today, tomorrow], at("12:00"))).toStrictEqual([today]);
  });
});

describe("who it is with", () => {
  it("separates a client meeting from an internal one", () => {
    const consultation = appointment(1, "09:00");
    const internal = appointment(2, "10:00", 60, {
      type: "Internal meeting",
      clientId: Option.none(),
    });

    expect(isClientFacing(consultation)).toBe(true);
    expect(isClientFacing(internal)).toBe(false);
  });
});
