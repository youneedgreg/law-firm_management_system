"use server";

import { Effect, Either, ParseResult, Schema } from "effect";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DocumentId } from "@/domain/shared/ids";
import {
  type ActionState,
  IDLE,
  refused,
  typedValues,
} from "@/lib/action-state";
import { attemptAs } from "@/runtime/session";
import { DocumentService } from "@/services/document-service";
import { asUploadDocument, fileFrom, UploadForm } from "./forms";

/**
 * The write side of the document register.
 *
 * Three actions, and the shape of each follows what it can refuse. Uploading
 * decodes a form *and* reads a file. Revising takes a file and an existing
 * document. Filing takes neither — it is a claim about the world, made with one
 * click, and the refusal it can produce is "this is already filed".
 */

const submitted = (form: FormData): Record<string, string> => {
  const fields: Record<string, string> = {};
  for (const [name, value] of form.entries()) {
    if (typeof value === "string" && value.trim() !== "") {
      fields[name] = value;
    }
  }
  return fields;
};

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
    return "The document could not be saved. The database refused the write; the details are in the server log.";
  }

  /**
   * The store failing is worth separating from the database failing, because
   * the two have different remedies and the person reading this can act on
   * neither — but whoever they call can.
   */
  if (error._tag === "StorageFailure") {
    return "The file could not be stored. Nothing was recorded, so the upload can be retried; the details are in the server log.";
  }

  if (error._tag === "NotFound") {
    return "That document is no longer on file. It may have been removed while this page was open.";
  }

  const reason: unknown = (error as { reason?: unknown }).reason;
  return typeof reason === "string"
    ? `${reason}.`
    : "The document could not be saved.";
};

export async function uploadDocument(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const values = typedValues(form);

  const decoded = Schema.decodeUnknownEither(UploadForm)(submitted(form), {
    errors: "all",
  });
  if (Either.isLeft(decoded)) return fromParseError(decoded.left, values);

  const file = await fileFrom(form, "file");
  if (Either.isLeft(file)) {
    return refused(file.left.reason, {
      fields: { file: file.left.reason },
      values,
    });
  }

  const outcome = await attemptAs(
    Effect.flatMap(DocumentService, (service) =>
      service.upload(asUploadDocument(decoded.right), file.right),
    ),
  );

  if (Either.isLeft(outcome)) return refused(explain(outcome.left), { values });

  revalidatePath("/documents");
  revalidatePath(`/cases/${decoded.right.caseId}`);
  redirect(`/documents/${outcome.right.id}`);
}

/**
 * A new version of a document already on file.
 *
 * The particulars are not re-asked: a revision is the same document, and
 * letting the name or the matter change here would make "version 3" mean
 * something different from "version 2" under one id. Renaming a document is a
 * different operation, and filing it somewhere else is a different document.
 */
export async function reviseDocument(
  id: string,
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const values = typedValues(form);

  const documentId = Schema.decodeUnknownEither(DocumentId)(id);
  if (Either.isLeft(documentId)) {
    return refused("That is not a document id.", { values });
  }

  const file = await fileFrom(form, "file");
  if (Either.isLeft(file)) {
    return refused(file.left.reason, {
      fields: { file: file.left.reason },
      values,
    });
  }

  const outcome = await attemptAs(
    Effect.flatMap(DocumentService, (service) =>
      service.revise(documentId.right, file.right),
    ),
  );

  if (Either.isLeft(outcome)) return refused(explain(outcome.left), { values });

  revalidatePath("/documents");
  revalidatePath(`/documents/${id}`);
  return IDLE;
}

/**
 * Recording that a document went to court.
 *
 * This is the point of no return for a document: filed documents are fixed, and
 * `revise` refuses them from here on. The form that calls it says so, because a
 * one-click action with a permanent consequence should not be a surprise.
 */
export async function fileDocument(
  id: string,
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const values = typedValues(form);

  const documentId = Schema.decodeUnknownEither(DocumentId)(id);
  if (Either.isLeft(documentId)) {
    return refused("That is not a document id.", { values });
  }

  const outcome = await attemptAs(
    Effect.flatMap(DocumentService, (service) =>
      service.markFiled(documentId.right),
    ),
  );

  if (Either.isLeft(outcome)) return refused(explain(outcome.left), { values });

  revalidatePath("/documents");
  revalidatePath(`/documents/${id}`);
  return IDLE;
}
