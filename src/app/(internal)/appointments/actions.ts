"use server";

import { Effect, Either, ParseResult, Schema } from "effect";
import { revalidatePath } from "next/cache";
import {
  type ActionState,
  IDLE,
  refused,
  typedValues,
} from "@/lib/action-state";
import { attemptAs } from "@/runtime/session";
import {
  AppointmentService,
  type CannotSchedule,
} from "@/services/appointment-service";
import { asBooking, ScheduleAppointmentForm, submitted } from "./forms";

/**
 * The write side of the diary.
 *
 * One action, and the interesting part is the refusal it can return. A clash is
 * not a validation error and not a server failure — it is the system knowing
 * something the person booking does not, and the message has to carry that
 * knowledge or the refusal is just an obstacle.
 */

const fromParseError = (
  error: ParseResult.ParseError,
  values: Readonly<Record<string, string>>,
): ActionState => {
  const issues = ParseResult.ArrayFormatter.formatErrorSync(error);
  const fields: Record<string, string> = {};

  for (const issue of issues) {
    const field = issue.path.join(".");
    if (field !== "" && fields[field] === undefined) {
      fields[field] = issue.message;
    }
  }

  const named = Object.keys(fields);
  return refused(
    named.length === 0
      ? (issues[0]?.message ?? "The form could not be read.")
      : `Check ${named.length === 1 ? "this field" : "these fields"}: ${named.join(", ")}.`,
    { fields, values },
  );
};

/**
 * Typed on the service's own failure union rather than `{ _tag: string }`.
 *
 * That is not fussiness: the loose shape would need a cast to read `advocate`
 * off a clash, and the cast is exactly what stops the compiler telling this
 * file when a new failure is added to `schedule`. Narrowing on `_tag` here is
 * free and total.
 */
const explain = (error: CannotSchedule): string => {
  if (error._tag === "RepositoryFailure") {
    return "The appointment could not be saved. The database refused the write; the details are in the server log.";
  }

  if (error._tag === "NotFound") {
    return "That advocate is no longer on the firm's list. They may have left while this page was open.";
  }

  /**
   * The clash, said in full.
   *
   * Naming what the collision was is the whole value of the check. "That time
   * is not free" sends somebody hunting through a diary they cannot see; "Adv.
   * Sarah Wanjiru is already down for Mention · OKL-2026-014" tells them to
   * ring the client or pick another advocate, which is what they were going to
   * have to do anyway.
   */
  if (error._tag === "DiaryClash") {
    return `${error.advocate} is already committed at that time: ${error.against.join("; ")}. Pick another time, or another advocate.`;
  }

  return `${error.reason}.`;
};

export async function scheduleAppointment(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const values = typedValues(form);
  const decoded = Schema.decodeUnknownEither(ScheduleAppointmentForm)(
    submitted(form),
    { errors: "all" },
  );

  if (Either.isLeft(decoded)) return fromParseError(decoded.left, values);

  const outcome = await attemptAs(
    Effect.flatMap(AppointmentService, (service) =>
      service.schedule(asBooking(decoded.right)),
    ),
  );

  if (Either.isLeft(outcome)) return refused(explain(outcome.left), { values });

  revalidatePath("/appointments");
  return IDLE;
}
