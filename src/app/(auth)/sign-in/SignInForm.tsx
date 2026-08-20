"use client";

import { useActionState } from "react";
import { TextField } from "@/components/form";
import { type ActionState, IDLE } from "@/lib/action-state";
import { signIn } from "./actions";

/**
 * The sign-in form.
 *
 * A plain `<form action={…}>` around the same `ActionState` every other form in
 * this application uses, so a refusal renders the same way here as a refused
 * intake does: one sentence, where it happened.
 *
 * `next` rides along as a hidden field rather than being read from the URL by
 * the action, because a Server Action does not receive the page's query string.
 * The action validates it as a relative path before redirecting — see the note
 * on `destination`.
 */
export function SignInForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    signIn,
    IDLE,
  );

  return (
    <form action={action} className="signin-form">
      <input type="hidden" name="next" value={next} />

      <TextField
        label="Email address"
        name="email"
        type="email"
        autoComplete="username"
        required
        wide
        defaultValue={state.values["email"] ?? ""}
      />

      <TextField
        label="Password"
        name="password"
        type="password"
        /**
         * `current-password` rather than `off`. Telling a password manager not
         * to help is how people end up with passwords they can remember, which
         * is the weaker outcome by a distance.
         */
        autoComplete="current-password"
        required
        wide
      />

      {state.status === "refused" && (
        <p className="form-error" role="alert">
          {state.reason}
        </p>
      )}

      <button className="btn btn-primary" type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
