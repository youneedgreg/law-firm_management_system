import { Effect, ParseResult, Schema } from "effect";
import { CaseId } from "@/domain/shared/ids";
import * as Time from "@/domain/time/entry";
import type { RecordTime } from "@/services/time-service";

/**
 * The boundary between the timesheet form and the domain.
 *
 * ## Minutes, from a start and an end
 *
 * The prototype's form took a start time and an end time and derived the hours
 * from them, which is how a person naturally records a day. The domain stores
 * *minutes* and nothing else, on the grounds stated in `domain/time/entry.ts`:
 * a model holding both the pair of clock times and the duration has two facts
 * that can disagree, and they do disagree the moment somebody edits a start
 * time.
 *
 * So the conversion happens here, once, at the boundary — the form keeps the
 * shape a person wants and the record keeps the shape that cannot go wrong.
 * What is lost is *when in the day* the work happened, and that is a real loss
 * worth naming: it is what a diary view would need. It is not what a bill
 * needs, and nothing in this system currently asks for it.
 *
 * An end before a start is refused rather than wrapped around midnight. Work
 * that genuinely crosses midnight is two entries on two days, which is also how
 * it has to be billed.
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

const Clock = Schema.String.pipe(
  Schema.pattern(/^([01]\d|2[0-3]):[0-5]\d$/),
  Schema.annotations({ identifier: "ClockTime" }),
);

const DayInput = Schema.transform(
  Schema.String.pipe(Schema.pattern(/^\d{4}-\d{2}-\d{2}$/)),
  Schema.DateFromSelf,
  {
    strict: true,
    decode: (day) => new Date(`${day}T00:00:00.000Z`),
    encode: (date) => date.toISOString().slice(0, 10),
  },
).annotations({ identifier: "DayInput" });

const minutesInto = (clock: string): number => {
  const [hours, minutes] = clock.split(":");
  return Number(hours) * 60 + Number(minutes);
};

/** Shillings per hour in, cents per hour stored. */
const RateShillings = Schema.transform(
  Schema.NumberFromString.pipe(Schema.nonNegative()),
  Schema.Int.pipe(Schema.nonNegative()),
  {
    strict: true,
    decode: (shillings) => Math.round(shillings * 100),
    encode: (cents) => cents / 100,
  },
);

/** An unticked checkbox is absent; a ticked one submits `"on"`. */
const Ticked = Schema.transform(Schema.Literal("on"), Schema.Boolean, {
  strict: true,
  decode: () => true,
  encode: () => "on" as const,
});

/** What the form produces, which is exactly what `TimeService.record` takes. */
const Recorded = Schema.Struct({
  caseId: CaseId,
  activity: Time.Activity,
  minutes: Schema.Int.pipe(Schema.positive()),
  workedOn: Schema.DateFromSelf,
  billable: Schema.Boolean,
  hourlyRateCents: Schema.Int.pipe(Schema.nonNegative()),
  narrative: Schema.NonEmptyTrimmedString,
});

const Typed = Schema.Struct({
  caseId: CaseId,
  activity: Time.Activity,
  workedOn: DayInput,
  start: Clock,
  end: Clock,
  hourlyRate: RateShillings,
  narrative: Schema.NonEmptyTrimmedString,
  nonBillable: Schema.optional(Ticked),
});

export const RecordTimeForm = Schema.transformOrFail(
  Typed,
  Schema.typeSchema(Recorded),
  {
    strict: true,

    /**
     * An end at or before the start is refused, with the message on `end`.
     *
     * Not wrapped around midnight. Work that genuinely crosses midnight is two
     * entries on two days — which is also how it has to be billed, because a
     * day is the unit a bill of costs is presented in.
     */
    decode: (
      form: typeof Typed.Type,
      _options,
      ast,
    ): Effect.Effect<typeof Recorded.Type, ParseResult.ParseIssue> => {
      const minutes = minutesInto(form.end) - minutesInto(form.start);

      if (minutes <= 0) {
        return ParseResult.fail(
          new ParseResult.Type(
            ast,
            form,
            `${form.end} is not after ${form.start}. Work that runs past ` +
              `midnight is two entries, on the two days it was done`,
          ),
        );
      }

      return ParseResult.succeed({
        caseId: form.caseId,
        activity: form.activity,
        minutes,
        workedOn: form.workedOn,
        billable: form.nonBillable !== true,
        hourlyRateCents: form.hourlyRate,
        narrative: form.narrative,
      });
    },

    /**
     * Decode-only, and it says so as a *value* rather than by throwing.
     *
     * There is no honest inverse: minutes cannot be turned back into a start
     * and an end without inventing the time of day the work began. Throwing
     * would make that a defect at run time; `Forbidden` makes it a refusal the
     * type system already knows about — and it is also what keeps this schema's
     * `Context` at `never`, since a `throw` types as the un-inferable `unknown`.
     */
    encode: (entry, _options, ast) =>
      ParseResult.fail(
        new ParseResult.Forbidden(
          ast,
          entry,
          "A time entry cannot be turned back into a start and an end: the " +
            "time of day was never recorded, only the duration",
        ),
      ),
  },
);

export const asRecordTime = (form: typeof RecordTimeForm.Type): RecordTime =>
  form;
