"use client";

import { useOptimistic, useState, useTransition } from "react";
import type { CaseStatus } from "@/domain/case/status";
import { caseStatusTag } from "@/lib/format";
import { moveCase } from "../actions";

/**
 * Moving a matter through its lifecycle.
 *
 * The buttons are exactly the transitions the domain allows — `mayBeMovedTo`
 * comes from `Status.TRANSITIONS` by way of the service, so there is no second
 * list here to fall out of step with the state machine. A matter that is Closed
 * offers one button, Appealed, because that is the only move the law of this
 * lifecycle permits.
 *
 * ## Why optimistic, and what it costs
 *
 * The status is shown as moved the moment the button is pressed, before the
 * server has agreed. That is honest here for a specific reason: the button was
 * built from the server's own list of legal moves, so the overwhelmingly likely
 * outcome is acceptance, and the round trip is a Neon query away — long enough
 * to feel like a hung button.
 *
 * When it is *not* accepted — the matter moved in another tab, so the move is
 * now illegal — `useOptimistic` discards the guess as soon as the transition
 * ends, and the panel snaps back to the real status with the service's own
 * reason underneath. The guess is never written anywhere; it exists only for
 * the length of the transition.
 */
export function StatusPanel({
  id,
  status,
  mayBeMovedTo,
}: {
  id: string;
  status: CaseStatus;
  mayBeMovedTo: readonly CaseStatus[];
}) {
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(status);
  const [refusal, setRefusal] = useState("");

  const move = (to: CaseStatus) => {
    setRefusal("");
    startTransition(async () => {
      setOptimistic(to);
      const result = await moveCase(id, to);
      // A refusal leaves `optimistic` to revert on its own when the transition
      // ends; all that is needed here is the reason it was refused.
      if (result.status === "refused") setRefusal(result.reason);
    });
  };

  return (
    <div>
      <div className="row row-tight">
        <span className={caseStatusTag(optimistic)}>{optimistic}</span>
        {pending && (
          <span className="dek" style={{ marginLeft: "var(--space-2)" }}>
            Saving…
          </span>
        )}
      </div>

      {mayBeMovedTo.length === 0 ? (
        <p className="dek">A matter in this state cannot change status.</p>
      ) : (
        <>
          <p className="dek">Move this matter to:</p>
          <div className="check-row">
            {mayBeMovedTo.map((to) => (
              <button
                key={to}
                type="button"
                className="btn btn-secondary"
                disabled={pending}
                onClick={() => move(to)}
              >
                {to}
              </button>
            ))}
          </div>
        </>
      )}

      {refusal !== "" && (
        <p className="form-refusal" role="alert">
          {refusal}
        </p>
      )}
    </div>
  );
}
