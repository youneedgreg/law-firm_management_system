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
import { HearingService } from "@/services/hearing-service";
import {
  asListing,
  asOutcome,
  hearingIdOf,
  ListHearingForm,
  RecordOutcomeForm,
  submitted,
} from "./forms";

/**
 * The write side of the court diary.
 *
 * Two actions, and the second does two things — recording the outcome and, for
 * an adjournment, listing the follow-on. That pairing is `HearingService`'s and
 * happens in one transaction; this action does not orchestrate it, which is the
 * point. An action that recorded the outcome and then made a second call to
 * list the next date would be a design with a window in it.
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

const explain = (error: { readonly _tag: string }): string => {
  if (error._tag === "RepositoryFailure") {
    return "The listing could not be saved. The database refused the write; the details are in the server log.";
  }

  if (error._tag === "NotFound") {
    return "That hearing is no longer on the diary. It may have been removed while this page was open.";
  }

  const reason: unknown = (error as { reason?: unknown }).reason;
  return typeof reason === "string"
    ? `${reason}.`
    : "The listing could not be saved.";
};

export async function listHearing(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const values = typedValues(form);
  const decoded = Schema.decodeUnknownEither(ListHearingForm)(submitted(form), {
    errors: "all",
  });

  if (Either.isLeft(decoded)) return fromParseError(decoded.left, values);

  const outcome = await attemptAs(
    Effect.flatMap(HearingService, (service) =>
      service.list(asListing(decoded.right)),
    ),
  );

  if (Either.isLeft(outcome)) return refused(explain(outcome.left), { values });

  revalidatePath("/calendar");
  return IDLE;
}

export async function recordOutcome(
  id: string,
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const values = typedValues(form);
  const hearingId = hearingIdOf(id);
  if (Either.isLeft(hearingId)) {
    return refused("That is not a hearing id.", { values });
  }

  const decoded = Schema.decodeUnknownEither(RecordOutcomeForm)(
    submitted(form),
    { errors: "all" },
  );

  if (Either.isLeft(decoded)) return fromParseError(decoded.left, values);

  const outcome = await attemptAs(
    Effect.flatMap(HearingService, (service) =>
      service.record(hearingId.right, asOutcome(decoded.right)),
    ),
  );

  if (Either.isLeft(outcome)) return refused(explain(outcome.left), { values });

  revalidatePath("/calendar");
  revalidatePath("/dashboard");
  return IDLE;
}
