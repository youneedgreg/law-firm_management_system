"use client";

import { Result, useRxValue, useRxSet } from "@effect-rx/rx-react";
import { useState } from "react";
import { FormDialog } from "@/components/FormDialog";
import { TextAreaField, TextField } from "@/components/form";
import { explain } from "@/rx/failure";
import { screenRx } from "@/rx/clients";

/**
 * The conflict screen, before a client is taken on.
 *
 * Its own dialog rather than a step inside the intake form, and that placement
 * is the argument. A conflict screen is a professional act performed *before*
 * deciding whether to act at all — the answer is often "decline the retainer",
 * at which point there is no client to create. Burying it inside a form whose
 * submit button says "Take on client" would frame it as a validation step on
 * the way to a foregone conclusion.
 *
 * It never says "clear". An empty result renders as what it actually is:
 * nothing matched, across this many matters. The count is the qualification,
 * and it is shown because "nothing across 1,240 matters" and "nothing across
 * three" are very different statements — and because the model has no business
 * turning either into a green tick.
 */
export function ConflictScreen() {
  const result = useRxValue(screenRx);
  const run = useRxSet(screenRx);
  const [clientName, setClientName] = useState("");
  const [opposing, setOpposing] = useState("");

  return (
    <FormDialog
      title="Conflict check"
      lede="Screens a prospective retainer against every matter the firm has on record. It reports what it matched; the decision is yours."
      trigger="Conflict check"
      triggerIcon="ph-duotone ph-scales"
      triggerVariant="btn-ghost"
      submitLabel="Screen"
      onSubmit={() => {
        run({
          clientName: clientName.trim(),
          opposingNames: opposing
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line !== ""),
        });
      }}
      /**
       * The dialog stays open on submit, because the result is the point. Every
       * other form here closes on success; this one has nothing to close *to*.
       */
      keepOpenOnSubmit
    >
      <TextField
        wide
        label="Prospective client"
        name="clientName"
        required
        placeholder="e.g. Coastal Freight Ltd"
        value={clientName}
        onChange={(event) => setClientName(event.target.value)}
      />
      <TextAreaField
        wide
        label="Other side"
        name="opposingNames"
        rows={3}
        placeholder="One party per line"
        hint="Everyone the prospective client would be against."
        value={opposing}
        onChange={(event) => setOpposing(event.target.value)}
      />

      <div style={{ gridColumn: "1 / -1" }}>
        {Result.builder(result)
          .onInitial(() => (
            <p className="field-hint">Nothing has been screened yet.</p>
          ))
          .onWaiting(() => <p className="field-hint">Screening…</p>)
          .onErrorTag("NotPermitted", (error) => (
            <p className="form-error">{error.reason}.</p>
          ))
          .onError((error) => <p className="form-error">{explain(error)}</p>)
          .onSuccess((screening) =>
            screening.findings.length === 0 ? (
              <p className="field-hint">
                Nothing matched across {screening.mattersSearched}{" "}
                {screening.mattersSearched === 1 ? "matter" : "matters"} on
                record. That is a statement about these records, not a
                clearance.
              </p>
            ) : (
              <>
                <p className="form-error">
                  {screening.findings.length}{" "}
                  {screening.findings.length === 1 ? "finding" : "findings"}{" "}
                  across {screening.mattersSearched}{" "}
                  {screening.mattersSearched === 1 ? "matter" : "matters"}.
                </p>
                <ul className="finding-list">
                  {screening.findings.map((finding, index) => (
                    <li key={`${finding.caseId}-${String(index)}`}>
                      <strong>{finding.party}</strong> · {finding.caseNumber}
                      {finding.matterClosed ? " (closed)" : ""}
                      <div className="dek">{finding.concern}</div>
                    </li>
                  ))}
                </ul>
              </>
            ),
          )
          .orNull()}
      </div>
    </FormDialog>
  );
}
