"use client";

import { useState } from "react";
import { ActionDialog } from "@/components/ActionDialog";
import { SelectField, TextAreaField, TextField } from "@/components/form";
import type { HearingId } from "@/domain/shared/ids";
import { recordOutcome } from "./actions";
import { constraintsOf } from "@/lib/form-constraints";
import { RecordOutcomeForm as RecordOutcomeSchema } from "./forms";

/** The constraints `RecordOutcomeSchema` already carries. See `lib/form-constraints.ts`. */
const field = constraintsOf(RecordOutcomeSchema);

/**
 * Recording how a hearing went.
 *
 * The adjournment fields appear when — and only when — the outcome is
 * `Adjourned`, and they are required then. That is the tagged union showing
 * through the form: `Adjourned` carries a destination and the other three do
 * not, so a form offering "adjourned to" alongside "heard" would be offering a
 * value the domain has no place to put.
 *
 * **Recording an adjournment lists the follow-on hearing**, in the same
 * transaction, inheriting the court, the room and the advocate. The dialog says
 * so before it is submitted, because it is a second write and somebody should
 * not discover it afterwards.
 */
export function RecordOutcomeForm({
  hearingId,
  matterNumber,
  scheduledFor,
}: {
  hearingId: HearingId;
  matterNumber: string;
  scheduledFor: string;
}) {
  const record = recordOutcome.bind(null, hearingId);
  const [outcome, setOutcome] = useState("Heard");

  return (
    <ActionDialog
      title={`${matterNumber} — ${scheduledFor}`}
      lede="What the court did on the day. An adjournment also lists the date the matter went to."
      trigger="Record"
      triggerVariant="btn-ghost"
      submitLabel="Record"
      pendingLabel="Recording…"
      action={record}
    >
      {(state) => {
        const kept = (name: string, fallback = "") =>
          state.values[name] ?? fallback;

        return (
          <>
            <SelectField
              wide
              label="Outcome"
              name="outcome"
              {...field("outcome")}
              defaultValue={kept("outcome", "Heard")}
              options={[
                { value: "Heard", label: "Heard" },
                { value: "Adjourned", label: "Adjourned" },
                { value: "NotReached", label: "Not reached" },
                { value: "Withdrawn", label: "Withdrawn" },
              ]}
              onChange={(event) => setOutcome(event.target.value)}
              error={state.fields["outcome"]}
            />

            {outcome === "Adjourned" ? (
              <>
                <TextField
                  label="Adjourned to"
                  name="adjournedOn"
                  type="date"
                  {...field("adjournedOn")}
                  defaultValue={kept("adjournedOn")}
                  hint="Must be after this hearing. The matter is listed for that date."
                  error={state.fields["adjournedOn"]}
                />
                <TextField
                  label="At"
                  name="adjournedAt"
                  type="time"
                  {...field("adjournedAt")}
                  defaultValue={kept("adjournedAt", "09:00")}
                  error={state.fields["adjournedAt"]}
                />
                <TextAreaField
                  wide
                  label="Why"
                  name="reason"
                  rows={2}
                  {...field("reason")}
                  defaultValue={kept("reason")}
                  placeholder="e.g. Respondent's counsel not ready"
                  error={state.fields["reason"]}
                />
              </>
            ) : (
              <TextAreaField
                wide
                label="Note"
                name="note"
                {...field("note")}
                rows={2}
                defaultValue={kept("note")}
                placeholder="Anything worth recording about the day"
                error={state.fields["note"]}
              />
            )}
          </>
        );
      }}
    </ActionDialog>
  );
}
