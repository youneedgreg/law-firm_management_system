"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { type ActionState, IDLE } from "@/lib/action-state";

/**
 * The create/edit dialog for forms that submit to a Server Action.
 *
 * `FormDialog` next door hands `FormData` to a callback and closes; every
 * module still on mock data uses it. This one is what a form looks like once
 * the server can say no: the action owns the outcome, the dialog stays open
 * when the server refuses, and the refusal is shown where it happened rather
 * than as a toast that outlives the form.
 *
 * The fields are a render prop so they can read the refusal — a message beside
 * the input that caused it is worth more than a summary at the bottom, and only
 * the caller knows which of its inputs is which.
 *
 * `action` is a `useActionState` reducer, which is why it takes the previous
 * state: React needs somewhere to put the result, and Next needs the form to
 * work before hydration. Both are satisfied by `<form action={…}>`, so a
 * submission made while the JavaScript is still loading is queued rather than
 * dropped.
 */
export function ActionDialog({
  title,
  lede,
  trigger,
  triggerIcon,
  triggerVariant = "btn-primary",
  submitLabel = "Save",
  pendingLabel,
  action,
  children,
}: {
  title: string;
  /** One line under the title, saying what the form will do. */
  lede?: string;
  trigger: string;
  /** Phosphor class for the trigger, e.g. "ph-duotone ph-plus". */
  triggerIcon?: string;
  triggerVariant?: "btn-primary" | "btn-secondary" | "btn-ghost";
  submitLabel?: string;
  pendingLabel?: string;
  action: (previous: ActionState, form: FormData) => Promise<ActionState>;
  children: (state: ActionState) => React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  const [state, formAction, pending] = useActionState(action, IDLE);

  /**
   * Closes the dialog when a submission comes back accepted.
   *
   * A submission that *redirects* never gets here — the page navigates instead,
   * which is what opening a matter does. This is for the edit case, where the
   * server accepts and the user stays put.
   *
   * The ref is what makes "came back accepted" distinguishable from "has not
   * been submitted": both are `idle`, and only one of them followed a pending
   * transition.
   */
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && state.status === "idle") {
      dialogRef.current?.close();
    }
    wasPending.current = pending;
  }, [pending, state]);

  /**
   * Remounts the fields whenever the action returns, so a refused form comes
   * back as it was typed.
   *
   * `state.values` puts the typed values back through `defaultValue`, and for
   * text inputs that is enough — React updates the attribute and the reset it
   * performs after an action reads it. **A `<select>` is different**: React
   * applies `defaultValue` by marking an option selected at mount and never
   * again, so the restored value is ignored and every dropdown snaps back to
   * its placeholder while the text fields keep their values. That is worse than
   * either outcome on its own, because the form then looks half-filled.
   *
   * Changing the key is the documented way to say "this is a different form
   * now". It costs the focus position, which a refusal has already taken.
   */
  const [seen, setSeen] = useState(state);
  const [attempt, setAttempt] = useState(0);
  if (seen !== state) {
    // React's own "adjust state when a prop changes" pattern: setting state
    // during render re-runs this component before anything is committed, and
    // is why the counter is not a ref.
    setSeen(state);
    setAttempt(attempt + 1);
  }

  return (
    <>
      <button
        type="button"
        className={`btn ${triggerVariant}`}
        onClick={() => dialogRef.current?.showModal()}
      >
        {triggerIcon && <i className={triggerIcon} aria-hidden />}
        {trigger}
      </button>

      <dialog
        ref={dialogRef}
        className="dialog-shell"
        aria-labelledby={titleId}
      >
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget)
              dialogRef.current?.close();
          }}
        >
          <form key={attempt} className="dialog" action={formAction}>
            <h2 className="dialog-title" id={titleId}>
              {title}
            </h2>
            {lede && <p className="dialog-lede">{lede}</p>}

            <div className="form-grid">{children(state)}</div>

            {state.status === "refused" && (
              <p className="form-refusal" role="alert">
                {state.reason}
              </p>
            )}

            <div className="dialog-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => dialogRef.current?.close()}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={pending}
              >
                {pending ? (pendingLabel ?? "Saving…") : submitLabel}
              </button>
            </div>
          </form>
        </div>
      </dialog>
    </>
  );
}
