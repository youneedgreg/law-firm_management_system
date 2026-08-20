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
import { CaseService } from "@/services/case-service";
import { AmendMatterForm, OpenMatterForm, submitted } from "./forms";

/**
 * The write side of the cases module.
 *
 * Three steps, in the same order every time: decode the submission through a
 * schema, hand the decoded value to `CaseService`, turn whatever comes back
 * into something the form can render. Nothing here decides whether a matter may
 * be filed or a status may move — those are the domain's and the service's, and
 * an action that re-checked them would be the copy that goes stale.
 *
 * Refusals come back as values, never as exceptions. `attempt` runs the effect
 * with `Effect.either`, so a typed failure — an advocate with no practising
 * certificate, a claim beyond the court's limit — becomes a message beside the
 * form, while a defect still rejects and reaches `error.tsx`. That distinction
 * is the whole reason the service's failures are in its type signature.
 */

/**
 * A parse failure, as messages against the inputs that caused it.
 *
 * `errors: "all"` on the decode above is what makes this worth doing: the
 * default stops at the first problem, so a form with three bad fields is fixed
 * three submissions later. `ArrayFormatter` keeps the path, which is the input's
 * `name`, so each message can be shown where it belongs.
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
      ? "The form could not be read."
      : `Check ${named.length === 1 ? "this field" : "these fields"}: ${named.join(", ")}.`,
    { fields, values },
  );
};

/**
 * A service failure, as a sentence.
 *
 * Every refusal the domain and the service raise carries a `reason` written for
 * an advocate — the rank and the statutory limit, the transitions a matter may
 * actually move to — so they are shown as they are.
 *
 * `RepositoryFailure` is the exception and is deliberately not shown. It
 * carries a driver message, which can carry the query, which can carry the
 * values; it goes to the log and the user gets a sentence that does not leak
 * anything.
 */
const explain = (error: { readonly _tag: string }): string => {
  if (error._tag === "RepositoryFailure") {
    console.error("[cases] repository failure", error);
    return "The matter could not be saved. The database refused the write; the details are in the server log.";
  }

  if (error._tag === "NotFound") {
    return "That matter is no longer on file. It may have been removed while this page was open.";
  }

  const reason: unknown = (error as { reason?: unknown }).reason;
  return typeof reason === "string"
    ? `${reason}.`
    : "The matter could not be saved.";
};

// ── Opening a matter ──────────────────────────────────────────────────────

export async function openCase(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const values = typedValues(form);
  const decoded = Schema.decodeUnknownEither(OpenMatterForm)(submitted(form), {
    errors: "all",
  });

  if (Either.isLeft(decoded)) return fromParseError(decoded.left, values);

  const outcome = await attemptAs(
    Effect.flatMap(CaseService, (service) => service.open(decoded.right)),
  );

  if (Either.isLeft(outcome)) return refused(explain(outcome.left), { values });

  revalidatePath("/cases");
  /**
   * `redirect` throws a control-flow exception, so nothing after it runs and
   * the return type above is never satisfied on this path. Landing on the new
   * matter rather than back on the list is the point: the reference the firm
   * will use from now on was just assigned, and the file is where it is shown.
   */
  redirect(`/cases/${outcome.right.id}`);
}

// ── Amending a matter ─────────────────────────────────────────────────────

export async function amendCase(
  id: string,
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const values = typedValues(form);
  const matterId = Schema.decodeUnknownEither(CaseId)(id);
  if (Either.isLeft(matterId)) {
    return refused("That is not a matter id.", { values });
  }

  const decoded = Schema.decodeUnknownEither(AmendMatterForm)(submitted(form), {
    errors: "all",
  });

  if (Either.isLeft(decoded)) return fromParseError(decoded.left, values);

  const outcome = await attemptAs(
    Effect.flatMap(CaseService, (service) =>
      service.amend(matterId.right, decoded.right),
    ),
  );

  if (Either.isLeft(outcome)) return refused(explain(outcome.left), { values });

  revalidatePath(`/cases/${id}`);
  revalidatePath("/cases");
  return IDLE;
}

// ── Moving a matter through the lifecycle ─────────────────────────────────

/**
 * There is deliberately no `moveCase` action.
 *
 * Phase 3 had one, and Phase 5 removed it: the status panel is a client
 * component driving an optimistic atom, and it moves a matter by calling the
 * `/cases/:id/status` endpoint through the generated client. Keeping a Server
 * Action beside it would be a second way in to the same service, with its own
 * decoding and its own translation of the same refusals — and the endpoint
 * already exists, is already in the contract, and is already covered by the API
 * tests.
 *
 * Opening and amending stay here, because both are forms. A `<form action>`
 * submits without JavaScript, keeps the browser's own validation, and hands
 * back per-field messages; a fetch from an atom would have to rebuild all of
 * that to arrive at the same place.
 */
