"use client";

import { ActionDialog } from "@/components/ActionDialog";
import { Checkbox, SelectField, TextField } from "@/components/form";
import { ACTIVITIES } from "@/domain/time/entry";
import type { CaseId } from "@/domain/shared/ids";
import { recordTime } from "./actions";

/**
 * Recording work.
 *
 * There is no fee-earner field, and its absence is the point: the entry is
 * attributed to whoever is signed in, so a timesheet is a first-hand record
 * rather than somebody's reconstruction of a colleague's day. The prototype had
 * a "Fee earner" dropdown; it is gone deliberately, not by omission — see the
 * note at the top of `services/time-service.ts` for what that costs.
 *
 * The form takes a start and an end because that is how a person records a day.
 * The domain stores minutes, and the conversion happens once at the boundary
 * (`forms.ts`) — a model holding both the clock times and the duration has two
 * facts that eventually disagree.
 */
export function LogTimeForm({
  matters,
}: {
  matters: readonly {
    readonly id: CaseId;
    readonly number: string;
    readonly title: string;
  }[];
}) {
  const today = new Date().toISOString().slice(0, 10);

  return (
    <ActionDialog
      title="Record time"
      lede="Hours are worked out from the start and end times, and recorded against the matter that will be billed for them."
      trigger="Record time"
      triggerIcon="ph-duotone ph-timer"
      submitLabel="Record"
      pendingLabel="Recording…"
      action={recordTime}
    >
      {(state) => {
        const kept = (name: string, fallback = "") =>
          state.values[name] ?? fallback;

        return (
          <>
            <SelectField
              wide
              label="Matter"
              name="caseId"
              required
              defaultValue={kept("caseId")}
              placeholder="Select a matter"
              options={matters.map((matter) => ({
                value: matter.id,
                label: `${matter.number} — ${matter.title}`,
              }))}
              hint="A closed matter does not accrue time; reopen it first."
              error={state.fields["caseId"]}
            />
            <SelectField
              label="Activity"
              name="activity"
              required
              defaultValue={kept("activity")}
              placeholder="Select an activity"
              options={[...ACTIVITIES]}
              error={state.fields["activity"]}
            />
            <TextField
              label="Date"
              name="workedOn"
              type="date"
              required
              defaultValue={kept("workedOn", today)}
              error={state.fields["workedOn"]}
            />

            <TextField
              label="Start"
              name="start"
              type="time"
              required
              defaultValue={kept("start")}
              error={state.fields["start"]}
            />
            <TextField
              label="End"
              name="end"
              type="time"
              required
              defaultValue={kept("end")}
              hint="Work running past midnight is two entries, on the two days."
              error={state.fields["end"]}
            />

            <TextField
              label="Rate (KES/hour)"
              name="hourlyRate"
              type="number"
              min="0"
              step="500"
              required
              defaultValue={kept("hourlyRate")}
              placeholder="20000"
              error={state.fields["hourlyRate"]}
            />
            <div className="field">
              <span className="field-legend">Billing</span>
              <div className="check-row">
                <Checkbox
                  name="nonBillable"
                  label="Non-billable"
                  defaultChecked={kept("nonBillable") === "on"}
                />
              </div>
              <p className="field-hint">
                Written-off work is still recorded &mdash; utilisation cannot be
                computed without it.
              </p>
            </div>

            <TextField
              wide
              label="Narrative"
              name="narrative"
              required
              defaultValue={kept("narrative")}
              placeholder="e.g. Drafting the plaint and verifying affidavit"
              hint="What a client would read if the bill were challenged."
              error={state.fields["narrative"]}
            />
          </>
        );
      }}
    </ActionDialog>
  );
}
