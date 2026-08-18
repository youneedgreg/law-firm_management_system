"use client";

import Link from "next/link";
import { useAppState } from "@/components/AppState";
import { FormDialog } from "@/components/FormDialog";
import { SelectField, TextField } from "@/components/form";
import { SectionTitle } from "@/components/ui";
import { ADVOCATES, CASES, courts } from "@/lib/data/cases";
import { HEARINGS, courtWeek } from "@/lib/data/hearings";
import { displayDate, displayTime } from "@/lib/format";
import { nextId, number, text } from "@/lib/forms";
import { HEARING_STATUSES, type HearingStatus } from "@/lib/types";

/**
 * The week strip and the diary are one component: both count the same
 * listings, so a hearing scheduled here shows up in both at once.
 */
export function CourtCalendar() {
  const { records } = useAppState();
  const hearings = [...records.hearings, ...HEARINGS];
  const week = courtWeek(hearings);

  return (
    <>
      <div className="week-grid">
        {week.map((day, index) => (
          <div
            className={day.isToday ? "day day-today" : "day"}
            key={`${day.label}-${index}`}
          >
            <div className="day-name">{day.label}</div>
            <div className="day-date">{day.date}</div>
            <div className="day-count">{day.count} hearings</div>
          </div>
        ))}
      </div>

      <SectionTitle>Court diary</SectionTitle>
      {hearings.map((hearing) => (
        <Link
          key={hearing.id}
          href={`/calendar/${hearing.id}`}
          className="row row-split row-link"
        >
          <div>
            <div className="row-title">{hearing.caseTitle}</div>
            <div className="row-meta">
              {hearing.court} · Room {hearing.room} · {hearing.judge} ·{" "}
              {hearing.advocate}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 14 }}>
              {hearing.date} {hearing.time}
            </div>
            <span className="tag tag-outline">{hearing.status}</span>
          </div>
        </Link>
      ))}
    </>
  );
}

export function ScheduleHearingForm() {
  const { records, add } = useAppState();
  const cases = [...records.cases, ...CASES];
  const hearings = [...HEARINGS, ...records.hearings];

  function schedule(fields: FormData) {
    const caseId = number(fields, "caseId");
    const legalCase = cases.find((entry) => entry.id === caseId);

    add("hearings", {
      id: nextId(hearings),
      caseId,
      caseTitle: legalCase?.title ?? "Unassigned matter",
      court: text(fields, "court"),
      room: text(fields, "room"),
      date: displayDate(text(fields, "date")),
      time: displayTime(text(fields, "time")),
      judge: text(fields, "judge") || legalCase?.judge || "To be assigned",
      advocate: text(fields, "advocate"),
      status: text(fields, "status") as HearingStatus,
    });
  }

  return (
    <FormDialog
      title="Schedule a hearing"
      lede="A listing in the court diary, with the advocate who will appear on it."
      trigger="Schedule hearing"
      triggerIcon="ph-duotone ph-gavel"
      submitLabel="Add to diary"
      onSubmit={schedule}
    >
      <SelectField
        wide
        label="Case"
        name="caseId"
        required
        defaultValue=""
        placeholder="Select a case"
        options={cases.map((legalCase) => ({
          value: String(legalCase.id),
          label: `${legalCase.number} — ${legalCase.title}`,
        }))}
      />
      <SelectField
        label="Court"
        name="court"
        required
        defaultValue=""
        placeholder="Select a court"
        options={courts()}
      />
      <TextField label="Court room" name="room" required placeholder="14" />
      <TextField label="Date" name="date" type="date" required />
      <TextField label="Time" name="time" type="time" required />
      <TextField
        label="Presiding judge"
        name="judge"
        placeholder="Hon. J. Kimani"
        hint="Left blank, the judge on the case file is used."
      />
      <SelectField
        label="Advocate appearing"
        name="advocate"
        required
        defaultValue=""
        placeholder="Select an advocate"
        options={ADVOCATES}
      />
      <SelectField
        wide
        label="Status"
        name="status"
        defaultValue="Awaiting confirmation"
        options={HEARING_STATUSES}
      />
    </FormDialog>
  );
}
