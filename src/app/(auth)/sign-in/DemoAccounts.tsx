"use client";

import { useActionState } from "react";
import { type ActionState, IDLE } from "@/lib/action-state";
import { DEMO_ACCOUNTS } from "@/lib/demo";
import { signInAs } from "./actions";

/**
 * The one-click role switcher (D-5).
 *
 * ## One form, six buttons
 *
 * Each button carries `name="account"` and its own `value`, which is how HTML
 * has always worked and which means the submitter is part of the submission —
 * so there is one form, one action, and one piece of pending state rather than
 * six of each. It also keeps the whole thing working with JavaScript
 * unavailable, exactly as the password form beside it does.
 *
 * ## Why the buttons are disabled *together*
 *
 * `pending` disables all six while one is in flight, and that is deliberate
 * rather than lazy. A second click during a sign-in would spend another demo
 * attempt and issue a second session, and the visible outcome would be
 * whichever redirect landed last — which reads as the switcher picking a role
 * at random. The one being signed in as says so; the others simply stop
 * accepting clicks.
 *
 * The refusal is the same `ActionState` sentence every other form in this
 * application renders, in the same place, with the same `role="alert"`. There
 * is no case where a visitor mistyped anything, so there is nothing to restore
 * and no field to attach a message to.
 */
export function DemoAccounts({ next }: { next: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    signInAs,
    IDLE,
  );

  return (
    <form action={action} className="demo-switcher">
      <input type="hidden" name="next" value={next} />

      <ul className="demo-roles">
        {DEMO_ACCOUNTS.map((account) => (
          <li key={account.key}>
            <button
              className="btn btn-sm"
              type="submit"
              name="account"
              value={account.key}
              disabled={pending}
            >
              {account.label}
            </button>
            <span>{account.shows}</span>
          </li>
        ))}
      </ul>

      {state.status === "refused" && (
        <p className="form-refusal" role="alert">
          {state.reason}
        </p>
      )}
    </form>
  );
}
