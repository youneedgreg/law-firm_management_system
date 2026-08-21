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
import { LibraryService } from "@/services/library-service";
import { asLogContact, LogContactForm, submitted } from "./forms";

/**
 * Logging a conversation.
 *
 * One action, and no "edit" or "delete" beside it — not because the record is
 * append-only (it is not; a summary written from memory should be correctable)
 * but because nothing in this slice needed one yet. That is a different reason
 * from the message thread's, and worth not confusing: `messages` has no edit
 * endpoint *by design*, and `contacts` has none *yet*.
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
    console.error("[communications] repository failure", error);
    return "The note could not be saved. The database refused the write; the details are in the server log.";
  }

  if (error._tag === "NotFound") {
    return "That record is no longer on file. It may have been removed while this page was open.";
  }

  const reason: unknown = (error as { reason?: unknown }).reason;
  return typeof reason === "string"
    ? `${reason}.`
    : "The note could not be saved.";
};

export async function logContact(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const values = typedValues(form);
  const decoded = Schema.decodeUnknownEither(LogContactForm)(submitted(form), {
    errors: "all",
  });

  if (Either.isLeft(decoded)) return fromParseError(decoded.left, values);

  const outcome = await attemptAs(
    Effect.flatMap(LibraryService, (service) =>
      service.logContact(asLogContact(decoded.right)),
    ),
  );

  if (Either.isLeft(outcome)) return refused(explain(outcome.left), { values });

  revalidatePath("/communications");
  revalidatePath(`/clients/${decoded.right.clientId}`);
  return IDLE;
}
