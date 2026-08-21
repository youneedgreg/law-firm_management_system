"use client";

import { useActionState } from "react";
import { IDLE } from "@/lib/action-state";
import type { TaskId } from "@/domain/shared/ids";
import { completeTask, reopenTask } from "./actions";

/**
 * Done, and undone.
 *
 * A bare form rather than a dialog, because neither is a decision anybody needs
 * warning about: completing a task is the ordinary case, and it is reversible —
 * `reopen` exists three pixels away. Compare filing a document with the court,
 * which is a dialog precisely because it cannot be undone.
 *
 * `useActionState` rather than a plain `<form action={…}>` so a refusal has
 * somewhere to be shown. It is rendered inline, in the row, because a toast
 * about "the task" is useless in a list of fourteen of them.
 */
export function CompleteButton({ id, done }: { id: TaskId; done: boolean }) {
  const action = (done ? reopenTask : completeTask).bind(null, id);
  const [state, submit, pending] = useActionState(action, IDLE);

  return (
    <form action={submit} className="cell-action">
      <button
        type="submit"
        className={done ? "btn btn-ghost btn-sm" : "btn btn-secondary btn-sm"}
        disabled={pending}
      >
        <i
          className={
            done
              ? "ph-duotone ph-arrow-counter-clockwise"
              : "ph-duotone ph-check"
          }
          aria-hidden
        />
        {pending ? "…" : done ? "Reopen" : "Done"}
      </button>
      {state.status === "refused" ? (
        <span className="field-error" role="alert">
          {state.reason}
        </span>
      ) : null}
    </form>
  );
}
