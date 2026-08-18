"use client";

import { useAppState } from "@/components/AppState";
import { FormDialog } from "@/components/FormDialog";
import { SelectField, TextField } from "@/components/form";
import { APPOINTMENTS } from "@/lib/data/work";
import { displayDate, displayTime } from "@/lib/format";
import { nextId, text } from "@/lib/forms";
import { APPOINTMENT_TYPES, type AppointmentType } from "@/lib/types";

export function AppointmentList() {
  const { records } = useAppState();
  const appointments = [...records.appointments, ...APPOINTMENTS];

  return (
    <>
      {appointments.map((appointment) => (
        <div className="row row-split" key={appointment.id}>
          <div>
            <div className="row-title">{appointment.title}</div>
            <div className="row-meta">
              {appointment.with} · {appointment.type}
            </div>
          </div>
          <div style={{ fontSize: 14, whiteSpace: "nowrap" }}>
            {appointment.date} {appointment.time}
          </div>
        </div>
      ))}
    </>
  );
}

export function ScheduleAppointmentForm() {
  const { records, add } = useAppState();
  const appointments = [...APPOINTMENTS, ...records.appointments];

  function schedule(fields: FormData) {
    add("appointments", {
      id: nextId(appointments),
      title: text(fields, "title"),
      with: text(fields, "with"),
      type: text(fields, "type") as AppointmentType,
      date: displayDate(text(fields, "date")),
      time: displayTime(text(fields, "time")),
    });
  }

  return (
    <FormDialog
      title="Schedule an appointment"
      lede="Consultations, internal meetings and court appearances the front desk keeps."
      trigger="Schedule"
      triggerIcon="ph-duotone ph-calendar-plus"
      submitLabel="Schedule"
      onSubmit={schedule}
    >
      <TextField
        wide
        label="Title"
        name="title"
        required
        placeholder="e.g. New client consultation"
      />
      <TextField
        wide
        label="With"
        name="with"
        required
        placeholder="Client, colleague or court"
      />
      <SelectField
        label="Type"
        name="type"
        defaultValue="Client consultation"
        options={APPOINTMENT_TYPES}
      />
      <TextField label="Date" name="date" type="date" required />
      <TextField label="Time" name="time" type="time" required />
    </FormDialog>
  );
}
