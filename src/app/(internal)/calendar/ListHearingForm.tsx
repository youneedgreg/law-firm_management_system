"use client";

import { ActionDialog } from "@/components/ActionDialog";
import { SelectField, TextField } from "@/components/form";
import { HEARING_KINDS } from "@/domain/court/hearing";
import type { HearingChoices } from "@/services/hearing-service";
import { COURT_OPTIONS } from "../cases/courts";
import { listHearing } from "./actions";

/**
 * Listing a matter for hearing.
 *
 * The court is picked whole from the firm's list — the same `COURT_OPTIONS`
 * intake uses — rather than assembled from a kind, a station and a rank. Four
 * free inputs can produce a magistrates' court with no rank, which is exactly
 * the value the tagged union exists to forbid, and a firm files in a known set
 * of stations anyway.
 *
 * A date *and* a time, because a hearing is a moment. A diary that stored only
 * the day could not tell an advocate whether they can be in two courts on the
 * same morning, which is the question the diary is for.
 */
export function ListHearingForm({ choices }: { choices: HearingChoices }) {
  const today = new Date().toISOString().slice(0, 10);

  return (
    <ActionDialog
      title="List a matter"
      lede="A court date for an open matter. The court is checked against the claim, exactly as it is at filing."
      trigger="List a hearing"
      triggerIcon="ph-duotone ph-gavel"
      submitLabel="List"
      pendingLabel="Listing…"
      action={listHearing}
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
              options={choices.matters.map((matter) => ({
                value: matter.id,
                label: `${matter.number} — ${matter.title}`,
              }))}
              hint="Closed matters are not listed; reopen one first if the court has."
              error={state.fields["caseId"]}
            />

            <SelectField
              label="What for"
              name="kind"
              required
              defaultValue={kept("kind")}
              placeholder="Select"
              options={[...HEARING_KINDS]}
              error={state.fields["kind"]}
            />
            <SelectField
              label="Court"
              name="court"
              required
              defaultValue={kept("court")}
              placeholder="Select a court"
              options={COURT_OPTIONS}
              error={state.fields["court"]}
            />

            <TextField
              label="Date"
              name="scheduledOn"
              type="date"
              required
              defaultValue={kept("scheduledOn", today)}
              hint="A date behind today is refused — it is almost always the year."
              error={state.fields["scheduledOn"]}
            />
            <TextField
              label="Time"
              name="scheduledAt"
              type="time"
              required
              defaultValue={kept("scheduledAt", "09:00")}
              error={state.fields["scheduledAt"]}
            />

            <SelectField
              label="Attending"
              name="advocateId"
              required
              defaultValue={kept("advocateId")}
              placeholder="Select"
              options={choices.advocates.map((advocate) => ({
                value: advocate.id,
                label: `${advocate.name} — ${advocate.role}`,
              }))}
              error={state.fields["advocateId"]}
            />
            <TextField
              label="Court room"
              name="room"
              defaultValue={kept("room")}
              placeholder="e.g. 14"
              error={state.fields["room"]}
            />
          </>
        );
      }}
    </ActionDialog>
  );
}
