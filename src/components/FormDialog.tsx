"use client";

import { useId, useRef } from "react";

/**
 * The create/edit dialog every "New …" button opens.
 *
 * The native <dialog> element does the modal work — focus trap, Esc to close,
 * the rest of the page made inert — while the design system's own
 * `.dialog-backdrop` and `.dialog` supply the look, so the element itself is
 * stripped back to a transparent frame in globals.css.
 */
export function FormDialog({
  title,
  lede,
  trigger,
  triggerIcon,
  triggerVariant = "btn-primary",
  submitLabel = "Save",
  onSubmit,
  keepOpenOnSubmit = false,
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
  onSubmit: (fields: FormData) => void;
  /**
   * Stays open after submitting, for the form whose *answer* is the point.
   *
   * Every other dialog here closes on submit because the result of submitting
   * is a changed record on the page behind it. The conflict screen has nothing
   * to close to: it reports findings, and closing the dialog would throw away
   * the only thing the user asked for.
   */
  keepOpenOnSubmit?: boolean;
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const titleId = useId();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(new FormData(event.currentTarget));
    if (!keepOpenOnSubmit) dialogRef.current?.close();
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
        // Whether it closed on Cancel, Esc or a submit, the next open starts
        // from a blank form.
        onClose={() => formRef.current?.reset()}
      >
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget)
              dialogRef.current?.close();
          }}
        >
          <form ref={formRef} className="dialog" onSubmit={handleSubmit}>
            <h2 className="dialog-title" id={titleId}>
              {title}
            </h2>
            {lede && <p className="dialog-lede">{lede}</p>}

            <div className="form-grid">{children}</div>

            <div className="dialog-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => dialogRef.current?.close()}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                {submitLabel}
              </button>
            </div>
          </form>
        </div>
      </dialog>
    </>
  );
}
