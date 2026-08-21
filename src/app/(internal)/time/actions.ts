"use server";

import { Effect, Either, ParseResult, Schema } from "effect";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CaseId } from "@/domain/shared/ids";
import {
  type ActionState,
  IDLE,
  refused,
  typedValues,
} from "@/lib/action-state";
import { attemptAs } from "@/runtime/session";
import { BillingService } from "@/services/billing-service";
import { TimeService } from "@/services/time-service";
import { asRecordTime, RecordTimeForm, submitted } from "./forms";

/**
 * The write side of time tracking.
 *
 * Two actions. Recording work, and turning a matter's unbilled work into a fee
 * note — which lives here rather than in `billing/actions.ts` because it is
 * started from the timesheet, by the person looking at what has not been
 * billed. It calls `BillingService`, so the rules are still billing's.
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
      ? // The start/end check fails on the struct rather than on a field, so
        // there is no input to hang it off. Its message is the useful part.
        (ParseResult.ArrayFormatter.formatErrorSync(error)[0]?.message ??
          "The form could not be read.")
      : `Check ${named.length === 1 ? "this field" : "these fields"}: ${named.join(", ")}.`,
    { fields, values },
  );
};

const explain = (error: { readonly _tag: string }): string => {
  if (error._tag === "RepositoryFailure") {
    return "The entry could not be saved. The database refused the write; the details are in the server log.";
  }

  if (error._tag === "NotFound") {
    return "That record is no longer on file. It may have been removed while this page was open.";
  }

  const reason: unknown = (error as { reason?: unknown }).reason;
  return typeof reason === "string"
    ? `${reason}.`
    : "The entry could not be saved.";
};

export async function recordTime(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const values = typedValues(form);
  const decoded = Schema.decodeUnknownEither(RecordTimeForm)(submitted(form), {
    errors: "all",
  });

  if (Either.isLeft(decoded)) return fromParseError(decoded.left, values);

  const outcome = await attemptAs(
    Effect.flatMap(TimeService, (time) =>
      time.record(asRecordTime(decoded.right)),
    ),
  );

  if (Either.isLeft(outcome)) return refused(explain(outcome.left), { values });

  revalidatePath("/time");
  return IDLE;
}

/**
 * Turns a matter's unbilled work into a fee note.
 *
 * Started from the timesheet and answered by `BillingService`, which is where
 * the rules are: the lines are grouped by activity and rate, the entries are
 * claimed atomically, and a race with somebody else billing the same matter
 * fails the whole thing rather than double-billing the client.
 */
export async function billMatter(
  caseId: string,
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const values = typedValues(form);
  const matterId = Schema.decodeUnknownEither(CaseId)(caseId);
  if (Either.isLeft(matterId)) {
    return refused("That is not a matter id.", { values });
  }

  const issued = new Date();
  const outcome = await attemptAs(
    Effect.flatMap(BillingService, (billing) =>
      billing.raiseFromTime(matterId.right, {
        issuedOn: issued,
        // The firm's usual terms. Editable on the fee note once it exists,
        // which is the right place for a decision about one client.
        dueOn: new Date(issued.getTime() + 30 * 24 * 60 * 60 * 1000),
      }),
    ),
  );

  if (Either.isLeft(outcome)) return refused(explain(outcome.left), { values });

  revalidatePath("/time");
  revalidatePath("/billing");
  redirect(`/billing/invoices/${outcome.right.id}`);
}
