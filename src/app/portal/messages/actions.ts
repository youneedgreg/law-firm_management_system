"use server";

import { Effect, Either, Option, Schema } from "effect";
import { revalidatePath } from "next/cache";
import { ClientId } from "@/domain/shared/ids";
import { type ActionState, IDLE, refused } from "@/lib/action-state";
import { attemptAs } from "@/runtime/session";
import { MessageService } from "@/services/message-service";

/**
 * Sending a message.
 *
 * One action, used from both sides of the system — the portal composer and the
 * firm's thread view. The author is not a parameter and never will be: it comes
 * from whoever is signed in, so the same code path serves a client writing to
 * their advocate and an advocate writing back, and neither can send as the
 * other.
 *
 * There is deliberately no `editMessage` and no `deleteMessage`. What was said
 * to a client is part of the retainer's history; a correction is a new message
 * saying so. The domain, Postgres and the API all say the same thing, and this
 * file is simply where there is nothing to write.
 */
export async function sendMessage(
  clientId: string,
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const to = Schema.decodeUnknownEither(ClientId)(clientId);
  if (Either.isLeft(to)) return refused("That is not a client.");

  const body = form.get("body");
  if (typeof body !== "string" || body.trim() === "") {
    return refused("Write something first.", { fields: { body: "Required" } });
  }

  const outcome = await attemptAs(
    Effect.flatMap(MessageService, (service) =>
      service.send({
        clientId: to.right,
        /**
         * Absent. A client writing from the portal is not asked to pick a
         * matter — most messages are about "the case", they have one or two,
         * and a dropdown would be a small tax on every message to record
         * something the advocate can see from the thread. The firm's side can
         * file against a matter where it helps.
         */
        caseId: Option.none(),
        body,
      }),
    ),
  );

  if (Either.isLeft(outcome)) {
    const error = outcome.left;

    if (error._tag === "RepositoryFailure") {
      console.error("[messages] repository failure", error);
      return refused(
        "The message could not be sent. Nothing was recorded, so it can be retried.",
      );
    }

    const reason: unknown = (error as { reason?: unknown }).reason;
    return refused(
      typeof reason === "string"
        ? `${reason}.`
        : "The message could not be sent.",
    );
  }

  revalidatePath("/portal/messages");
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/communications");
  return IDLE;
}
