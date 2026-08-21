"use server";

import { Effect, Either, ParseResult, Schema } from "effect";
import { revalidatePath } from "next/cache";
import { AdvocateId, TaskId } from "@/domain/shared/ids";
import {
  type ActionState,
  IDLE,
  refused,
  typedValues,
} from "@/lib/action-state";
import { attemptAs } from "@/runtime/session";
import { TaskService } from "@/services/task-service";
import { asRaiseTask, RaiseTaskForm, submitted } from "./forms";

/**
 * The write side of the work list.
 *
 * Four actions and no "edit task". `Done` is reached by completing and left by
 * reopening; the assignee changes through `reassign`, which has its own audit
 * entry. A general amendment endpoint would let the status be set directly, and
 * the status and the completion record would then be able to disagree — which
 * is the one thing the schema, the domain and Postgres all separately forbid.
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
    console.error("[tasks] repository failure", error);
    return "The task could not be saved. The database refused the write; the details are in the server log.";
  }

  if (error._tag === "NotFound") {
    return "That record is no longer on file. It may have been removed while this page was open.";
  }

  const reason: unknown = (error as { reason?: unknown }).reason;
  return typeof reason === "string"
    ? `${reason}.`
    : "The task could not be saved.";
};

/** Everything a task write invalidates: the list, and the matter it sits on. */
const refresh = (caseId?: string) => {
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  if (caseId !== undefined) revalidatePath(`/cases/${caseId}`);
};

export async function raiseTask(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const values = typedValues(form);
  const decoded = Schema.decodeUnknownEither(RaiseTaskForm)(submitted(form), {
    errors: "all",
  });

  if (Either.isLeft(decoded)) return fromParseError(decoded.left, values);

  const outcome = await attemptAs(
    Effect.flatMap(TaskService, (service) =>
      service.raise(asRaiseTask(decoded.right)),
    ),
  );

  if (Either.isLeft(outcome)) return refused(explain(outcome.left), { values });

  refresh(decoded.right.caseId);
  return IDLE;
}

/**
 * Marks a task done.
 *
 * No payload beyond the id: who finished it is whoever is signed in. A form
 * field naming somebody else would be a claim about them that they did not
 * make — the same reasoning that keeps a fee-earner dropdown off the timesheet.
 */
export async function completeTask(
  id: string,
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const values = typedValues(form);
  const taskId = Schema.decodeUnknownEither(TaskId)(id);
  if (Either.isLeft(taskId)) {
    return refused("That is not a task id.", { values });
  }

  const outcome = await attemptAs(
    Effect.flatMap(TaskService, (service) => service.complete(taskId.right)),
  );

  if (Either.isLeft(outcome)) return refused(explain(outcome.left), { values });

  refresh();
  return IDLE;
}

export async function reopenTask(
  id: string,
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const values = typedValues(form);
  const taskId = Schema.decodeUnknownEither(TaskId)(id);
  if (Either.isLeft(taskId)) {
    return refused("That is not a task id.", { values });
  }

  const outcome = await attemptAs(
    Effect.flatMap(TaskService, (service) => service.reopen(taskId.right)),
  );

  if (Either.isLeft(outcome)) return refused(explain(outcome.left), { values });

  refresh();
  return IDLE;
}

export async function reassignTask(
  id: string,
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const values = typedValues(form);

  const taskId = Schema.decodeUnknownEither(TaskId)(id);
  const to = Schema.decodeUnknownEither(AdvocateId)(
    form.get("assignedTo") ?? "",
  );

  if (Either.isLeft(taskId)) {
    return refused("That is not a task id.", { values });
  }
  if (Either.isLeft(to)) {
    return refused("Choose somebody to hand it to.", {
      fields: { assignedTo: "Required" },
      values,
    });
  }

  const outcome = await attemptAs(
    Effect.flatMap(TaskService, (service) =>
      service.reassign(taskId.right, to.right),
    ),
  );

  if (Either.isLeft(outcome)) return refused(explain(outcome.left), { values });

  refresh();
  return IDLE;
}
