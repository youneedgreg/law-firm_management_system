"use client";

import { useActionState, useEffect, useRef } from "react";
import { IDLE } from "@/lib/action-state";
import type { ClientId } from "@/domain/shared/ids";
import { sendMessage } from "./actions";

/**
 * The composer.
 *
 * A plain form over a Server Action, not an atom. A message is not optimistic
 * state: showing it in the thread before the server has it would tell a client
 * their advocate has been written to when they have not, and a client acting on
 * that — assuming the firm knows something — is the failure worth avoiding.
 * It appears when it has been sent.
 *
 * The field clears on success and is *kept* on refusal, which is the opposite
 * of what an uncontrolled form does by default: React resets it once the action
 * returns, and a message somebody typed and lost to a network error is the
 * quickest way to stop using a portal.
 *
 * ## One component, two sides, and the copy is not shared
 *
 * The same form serves a client writing to the firm and an advocate writing
 * back — one action, one author rule, no chance of the two drifting. The
 * *words* around it cannot be shared, though: this said "Type a message to your
 * advocate…" on the firm's own client file until somebody read it there, which
 * is the sort of thing that only shows up on the screen. `writingTo` is the
 * one thing the two callers genuinely disagree about.
 */
export function Composer({
  clientId,
  writingTo = "your advocate",
}: {
  clientId: ClientId;
  /** Who the message is going to, in the second person. */
  writingTo?: string;
}) {
  const send = sendMessage.bind(null, clientId);
  const [state, submit, pending] = useActionState(send, IDLE);
  const field = useRef<HTMLInputElement>(null);

  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && state.status === "idle") {
      if (field.current !== null) field.current.value = "";
    }
    wasPending.current = pending;
  }, [pending, state]);

  return (
    <form action={submit} className="composer">
      <input
        ref={field}
        className="input"
        name="body"
        /*
          Hand-written: `sendMessage` reads one field and checks it inline
          rather than through a schema, because a schema for a single
          non-empty string would be a module to hold one line.
        */
        required
        disabled={pending}
        style={{ flex: 1 }}
        placeholder={`Type a message to ${writingTo}…`}
        aria-label={`Message ${writingTo}`}
        aria-invalid={state.status === "refused" ? true : undefined}
      />
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Sending…" : "Send"}
      </button>
      {state.status === "refused" ? (
        <p className="field-error" role="alert" style={{ width: "100%" }}>
          {state.reason}
        </p>
      ) : null}
    </form>
  );
}
