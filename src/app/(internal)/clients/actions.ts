"use server";

import { Effect, Either, ParseResult, Schema } from "effect";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ClientId } from "@/domain/shared/ids";
import {
  type ActionState,
  IDLE,
  refused,
  typedValues,
} from "@/lib/action-state";
import { attemptAs } from "@/runtime/session";
import { ClientService } from "@/services/client-service";
import {
  AmendClientForm,
  asAmend,
  asTakeOn,
  submitted,
  TakeOnClientForm,
} from "./forms";

/**
 * The write side of the clients module.
 *
 * There is deliberately **no `screenForConflicts` action**. The screen is an
 * atom calling the generated client — see `rx/clients.ts` — because it is
 * interaction rather than submission: somebody types a name, reads the
 * findings, remembers another party, and asks again. A form submission would
 * reload the route on each attempt and lose what was typed.
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

const explain = (error: { readonly _tag: string }): string => {
  if (error._tag === "RepositoryFailure") {
    console.error("[clients] repository failure", error);
    return "The client could not be saved. The database refused the write; the details are in the server log.";
  }

  if (error._tag === "NotFound") {
    return "That client is no longer on file. They may have been removed while this page was open.";
  }

  const reason: unknown = (error as { reason?: unknown }).reason;
  return typeof reason === "string"
    ? `${reason}.`
    : "The client could not be saved.";
};

export async function takeOnClient(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const values = typedValues(form);
  const decoded = Schema.decodeUnknownEither(TakeOnClientForm)(
    submitted(form),
    { errors: "all" },
  );

  if (Either.isLeft(decoded)) return fromParseError(decoded.left, values);

  const outcome = await attemptAs(
    Effect.flatMap(ClientService, (service) =>
      service.takeOn(asTakeOn(decoded.right)),
    ),
  );

  if (Either.isLeft(outcome)) return refused(explain(outcome.left), { values });

  revalidatePath("/clients");
  redirect(`/clients/${outcome.right.id}`);
}

export async function amendClient(
  id: string,
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const values = typedValues(form);
  const clientId = Schema.decodeUnknownEither(ClientId)(id);
  if (Either.isLeft(clientId)) {
    return refused("That is not a client id.", { values });
  }

  const decoded = Schema.decodeUnknownEither(AmendClientForm)(submitted(form), {
    errors: "all",
  });

  if (Either.isLeft(decoded)) return fromParseError(decoded.left, values);

  const outcome = await attemptAs(
    Effect.flatMap(ClientService, (service) =>
      service.amend(clientId.right, asAmend(decoded.right)),
    ),
  );

  if (Either.isLeft(outcome)) return refused(explain(outcome.left), { values });

  revalidatePath(`/clients/${id}`);
  revalidatePath("/clients");
  return IDLE;
}
