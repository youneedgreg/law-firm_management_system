import { Option, Schema } from "effect";
import { AdvocateId, AppointmentId, CaseId, ClientId } from "../shared/ids";

/**
 * Appointments — meetings the firm has agreed to attend.
 *
 * ## Three diaries, and why this is not one of the other two
 *
 * A **hearing** is a date the *court* set: the firm does not choose it, cannot
 * move it, and missing one can end a matter. A **task** is work with a
 * deadline but no particular hour — "draft the affidavit by Thursday" does not
 * say when on Thursday. An **appointment** is the third thing: a time the firm
 * agreed with somebody else, which it can move by asking them, and which
 * occupies an advocate for a span rather than a moment.
 *
 * That last property is what earns this module a table. A task and a hearing
 * are both points on a calendar; an appointment has a **duration**, and two
 * of them can overlap. So can an appointment and a hearing.
 *
 * ## The rule this exists for
 *
 * **An advocate cannot be in two places at once**, and the mistake that
 * actually happens is booking a consultation for ten o'clock on a morning
 * somebody is in court. The court date was set weeks earlier by somebody else,
 * the receptionist taking the call cannot see it, and the client arrives to an
 * empty office.
 *
 * `clashesWith` is therefore written against *both* — appointments and
 * hearings — because a clash check that only knew about appointments would
 * miss the one clash that matters most.
 */

export const TYPES = [
  "Client consultation",
  "Internal meeting",
  "Site visit",
  "Call",
] as const;

export const Type = Schema.Literal(...TYPES);
export type Type = typeof Type.Type;

/**
 * `Court appearance` is deliberately **not** a type here.
 *
 * The prototype offered it, and it is the one entry that should not exist: a
 * court appearance is a hearing, it belongs in the court diary, and it carries
 * a court, a kind and an outcome that this module has nowhere to put. Letting
 * somebody record one here would produce a second, weaker record of the thing
 * the whole system is arranged around not losing — and the two would disagree.
 */

export const Appointment = Schema.Struct({
  id: AppointmentId,
  title: Schema.NonEmptyTrimmedString,
  type: Type,
  /** Whose diary it occupies. The clash check is per advocate. */
  advocateId: AdvocateId,
  /** The client it is with, for anything client-facing. */
  clientId: Schema.Option(ClientId),
  /** The matter it concerns, where it concerns one. */
  caseId: Schema.Option(CaseId),
  startsAt: Schema.DateFromSelf,
  /**
   * Minutes, not an end time.
   *
   * The same reasoning as a time entry storing minutes: a start and an end are
   * two facts that can disagree the moment somebody edits one, and an
   * appointment that ends before it begins is representable if both are stored.
   * The form asks for a start and a length, because that is how people book.
   */
  minutes: Schema.Int.pipe(Schema.positive()),
  /** Where, for anything that is not a call. */
  location: Schema.optional(Schema.NonEmptyTrimmedString),
});

export type Appointment = typeof Appointment.Type;

export const endsAt = (appointment: Appointment): Date =>
  new Date(appointment.startsAt.getTime() + appointment.minutes * 60 * 1000);

/** A span somebody's diary is occupied for. */
export interface Busy {
  readonly advocateId: AdvocateId;
  readonly from: Date;
  readonly to: Date;
  /** What is occupying it, for the message. */
  readonly what: string;
}

export const occupies = (appointment: Appointment): Busy => ({
  advocateId: appointment.advocateId,
  from: appointment.startsAt,
  to: endsAt(appointment),
  what: appointment.title,
});

/**
 * Whether two spans overlap.
 *
 * Half-open: an appointment ending at ten and another starting at ten do
 * **not** clash. That is the boundary people actually book on — back-to-back
 * consultations are normal and a system that refused them would be turned off
 * — and it is the case a naive `from <= other.to` gets wrong.
 */
const overlaps = (a: Busy, b: Busy): boolean =>
  a.advocateId === b.advocateId &&
  a.from.getTime() < b.to.getTime() &&
  b.from.getTime() < a.to.getTime();

/**
 * What this appointment would collide with.
 *
 * Takes spans rather than appointments so a hearing can be one — the clash
 * that matters most is with a court date, and a check that only knew about
 * appointments would miss it entirely.
 *
 * Returns every collision rather than the first: "you are already with a
 * client and in court" is worth saying once rather than discovering twice.
 */
export const clashesWith = (
  proposed: Busy,
  diary: readonly Busy[],
): readonly Busy[] => diary.filter((busy) => overlaps(proposed, busy));

export class DiaryClash extends Schema.TaggedError<DiaryClash>()("DiaryClash", {
  advocate: Schema.String,
  /** What they are already doing, in the order it happens. */
  against: Schema.Array(Schema.String),
  at: Schema.Date,
}) {
  get reason(): string {
    const when = this.at.toISOString().slice(11, 16);
    return (
      `${this.advocate} is already committed at ${when}: ` +
      `${this.against.join("; ")}. Two places at once is the booking that ` +
      `leaves a client sitting in reception`
    );
  }
}

/** Appointments that have not happened yet, soonest first. */
export const upcoming = (
  appointments: readonly Appointment[],
  asAt: Date,
): readonly Appointment[] =>
  [...appointments]
    .filter((appointment) => endsAt(appointment).getTime() >= asAt.getTime())
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

/** Everything in one advocate's day, for the clash check and the diary view. */
export const onDay = (
  appointments: readonly Appointment[],
  day: Date,
): readonly Appointment[] => {
  const from = new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()),
  ).getTime();
  const to = from + 24 * 60 * 60 * 1000;

  return appointments.filter(
    (appointment) =>
      appointment.startsAt.getTime() >= from &&
      appointment.startsAt.getTime() < to,
  );
};

/** A hearing occupies a morning. Court does not publish an end time. */
export const HEARING_MINUTES = 180;

export const asBusy = (
  advocateId: AdvocateId,
  startsAt: Date,
  minutes: number,
  what: string,
): Busy => ({
  advocateId,
  from: startsAt,
  to: new Date(startsAt.getTime() + minutes * 60 * 1000),
  what,
});

/** Whether a client was named, for screens that separate internal meetings. */
export const isClientFacing = (appointment: Appointment): boolean =>
  Option.isSome(appointment.clientId);
