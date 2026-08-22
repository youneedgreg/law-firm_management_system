"use client";

import { Result, useRxSet, useRxValue } from "@effect-rx/rx-react";
import { Exit } from "effect";
import { useRouter } from "next/navigation";
import type { CaseStatus } from "@/domain/case/status";
import type { CaseId } from "@/domain/shared/ids";
import { caseStatusTag } from "@/lib/format";
import { moveRx, showingStatusRx } from "@/rx/cases";
import { explain } from "@/rx/failure";

/**
 * Moving a matter through its lifecycle.
 *
 * The buttons are exactly the transitions the domain allows — `mayBeMovedTo`
 * comes from `Status.TRANSITIONS` by way of the service, so there is no second
 * list here to fall out of step with the state machine. A matter that is Closed
 * offers one button, Appealed, because that is the only move the law of this
 * lifecycle permits.
 *
 * ## Three values, no state
 *
 * There is no `useState` in this component and no `useOptimistic` either. The
 * status being shown, whether a move is in flight, and why the last one was
 * refused are all read out of two atoms:
 *
 * - `showingStatusRx` is the server's status wrapped in `Rx.optimistic`. The
 *   mutation moves it ahead of the server and it reverts on its own if the
 *   server disagrees. The guess is never written anywhere.
 * - `moveRx` is the mutation, and its `Result` is both the spinner and the
 *   message: `waiting` while the request is out, and a `Failure` carrying the
 *   refusal — an `InvalidTransition` whose `reason` names the moves that
 *   *were* available. That sentence is composed on the server by the domain's
 *   transition table and never transmitted; both ends hold the class, so it is
 *   reconstituted here.
 *
 * ## Why optimistic, and what it costs
 *
 * The status shows as moved the moment the button is pressed, before the server
 * has agreed. That is honest here because the button was built from the
 * server's own list of legal moves, so acceptance is the overwhelmingly likely
 * outcome, and the round trip is a Neon query away — long enough for a button
 * that does nothing to feel broken.
 *
 * When it is *not* accepted — the matter moved in another tab, so this move is
 * now illegal — the panel snaps back to the real status with the service's
 * reason underneath.
 *
 * ## Why the router is still refreshed
 *
 * The page around this panel is server-rendered, and a matter that has moved to
 * Closed offers different transitions and a different limitation position. The
 * atom knows the new status; only the server knows the rest. `router.refresh()`
 * re-reads the segment, which hands this component a new `status` prop — and
 * because the atoms are keyed by the matter *and* its status, that is a new
 * atom rather than an old one holding a stale answer.
 */
export function StatusPanel({
  id,
  status,
  mayBeMovedTo,
}: {
  id: CaseId;
  status: CaseStatus;
  mayBeMovedTo: readonly CaseStatus[];
}) {
  const router = useRouter();
  const matter = { id, status };

  const showing = useRxValue(showingStatusRx(matter));
  const move = useRxValue(moveRx(matter));
  const requestMove = useRxSet(moveRx(matter), { mode: "promiseExit" });

  const pending = move.waiting;

  const refusal = Result.builder(move)
    .onWaiting(() => "")
    .onError(explain)
    .onDefect(
      () => "The matter could not be moved. The details are in the server log.",
    )
    .orElse(() => "");

  const requested = async (to: CaseStatus): Promise<void> => {
    const outcome = await requestMove(to);
    if (Exit.isSuccess(outcome)) router.refresh();
  };

  return (
    <div>
      {/*
        The whole point of this panel is that the status changes under you —
        optimistically, and then again if the server disagrees. On screen that
        is obvious and to a screen reader it is silent, so the region that
        holds the status is the region that announces it. `role="status"` is
        polite: it waits for a pause rather than cutting across whatever is
        being read.
      */}
      <div className="row row-tight" role="status">
        <span className={caseStatusTag(showing)}>{showing}</span>
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
                onClick={() => void requested(to)}
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
