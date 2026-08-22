"use client";

import { ActionDialog } from "@/components/ActionDialog";
import { SelectField, TextField } from "@/components/form";
import { TYPES } from "@/domain/diary/appointment";
import type { DiaryChoices } from "@/services/appointment-service";
import { scheduleAppointment } from "./actions";
import { constraintsOf } from "@/lib/form-constraints";
import {
  LENGTHS,
  ScheduleAppointmentForm as ScheduleAppointmentSchema,
} from "./forms";

/** The constraints `ScheduleAppointmentSchema` already carries. See `lib/form-constraints.ts`. */
const field = constraintsOf(ScheduleAppointmentSchema);

/**
 * Booking an appointment.
 *
 * The client and the matter are optional selects rather than the old free-text
 * "With", which could say "Wanjiku" and mean nobody in particular. An internal
 * meeting leaves both empty; a consultation picks the client, and the matter if
 * there is one.
 *
 * There is deliberately no "Court appearance" among the types. That is a
 * hearing — it has a court, a cause number and an outcome to record — and
 * offering it here would let somebody put a court date somewhere the court
 * diary cannot see it. The mock this replaced offered exactly that.
 *
 * A length rather than an end time, because that is the question somebody
 * booking a meeting can answer.
 */
export function ScheduleAppointmentForm({
  choices,
}: {
  choices: DiaryChoices;
}) {
  const today = new Date().toISOString().slice(0, 10);

  return (
    <ActionDialog
      title="Schedule an appointment"
      lede="Consultations, internal meetings and site visits. A court date is listed on the calendar instead, where it can be given an outcome."
      trigger="Schedule"
      triggerIcon="ph-duotone ph-calendar-plus"
      submitLabel="Schedule"
      pendingLabel="Checking the diary…"
      action={scheduleAppointment}
    >
      {(state) => {
        const kept = (name: string, fallback = "") =>
          state.values[name] ?? fallback;

        return (
          <>
            <TextField
              wide
              label="What it is"
              name="title"
              {...field("title")}
              defaultValue={kept("title")}
              placeholder="e.g. Consultation — settlement terms"
              error={state.fields["title"]}
            />

            <SelectField
              label="Type"
              name="type"
              {...field("type")}
              defaultValue={kept("type", "Client consultation")}
              options={[...TYPES]}
              error={state.fields["type"]}
            />
            <SelectField
              label="Who is taking it"
              name="advocateId"
              {...field("advocateId")}
              defaultValue={kept("advocateId")}
              placeholder="Select"
              options={choices.staff.map((each) => ({
                value: each.id,
                label: each.name,
              }))}
              hint="Their court diary is checked as well as this one."
              error={state.fields["advocateId"]}
            />

            <TextField
              label="Date"
              name="startsOn"
              type="date"
              {...field("startsOn")}
              defaultValue={kept("startsOn", today)}
              error={state.fields["startsOn"]}
            />
            <TextField
              label="Time"
              name="startsAt"
              type="time"
              {...field("startsAt")}
              defaultValue={kept("startsAt", "09:00")}
              error={state.fields["startsAt"]}
            />

            <SelectField
              label="How long"
              name="minutes"
              {...field("minutes")}
              defaultValue={kept("minutes", "60")}
              options={LENGTHS.map((length) => ({
                value: length.value,
                label: length.label,
              }))}
              error={state.fields["minutes"]}
            />
            <TextField
              label="Where"
              name="location"
              {...field("location")}
              defaultValue={kept("location")}
              placeholder="e.g. Boardroom"
              error={state.fields["location"]}
            />

            <SelectField
              wide
              label="Client"
              name="clientId"
              {...field("clientId")}
              defaultValue={kept("clientId")}
              placeholder="Nobody outside the firm"
              options={choices.clients.map((client) => ({
                value: client.id,
                label: client.name,
              }))}
              hint="Leave empty for an internal meeting."
              error={state.fields["clientId"]}
            />
            <SelectField
              wide
              label="Matter"
              name="caseId"
              {...field("caseId")}
              defaultValue={kept("caseId")}
              placeholder="Not about a particular matter"
              options={choices.matters.map((matter) => ({
                value: matter.id,
                label: `${matter.number} — ${matter.title}`,
              }))}
              error={state.fields["caseId"]}
            />
          </>
        );
      }}
    </ActionDialog>
  );
}
