"use client";

import { useRxValue } from "@effect-rx/rx-react";
import { useAddRecord } from "@/rx/hooks";
import { recordsRx } from "@/rx/session";
import { FormDialog } from "@/components/FormDialog";
import { SegmentedField, SelectField, TextField } from "@/components/form";
import { TableWrap } from "@/components/ui";
import { ADVOCATES, CASES } from "@/lib/data/cases";
import { STAFF } from "@/lib/data/firm";
import { TIME_ENTRIES } from "@/lib/data/work";
import { billableTag, hoursBetween } from "@/lib/format";
import { nextId, text } from "@/lib/forms";
import { TIME_ACTIVITIES, type TimeActivity } from "@/lib/types";

export function TimeTable() {
  const records = useRxValue(recordsRx);
  const entries = [...records.timeEntries, ...TIME_ENTRIES];
  const billableHours = entries
    .filter((entry) => entry.billable)
    .reduce((total, entry) => total + entry.hours, 0);

  return (
    <>
      <TableWrap>
        <table className="table">
          <thead>
            <tr>
              <th>Case</th>
              <th>Lawyer</th>
              <th>Activity</th>
              <th>Start</th>
              <th>End</th>
              <th>Hours</th>
              <th>Billable</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.case}</td>
                <td>{entry.lawyer}</td>
                <td>{entry.activity}</td>
                <td>{entry.start}</td>
                <td>{entry.end}</td>
                <td>{entry.hours}</td>
                <td>
                  <span className={billableTag(entry.billable)}>
                    {entry.billable ? "Billable" : "Non-billable"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>

      <p style={{ marginTop: "var(--space-4)", fontSize: 15 }}>
        Total billable hours this month: <strong>{billableHours}</strong>
      </p>
    </>
  );
}

export function LogTimeForm() {
  const records = useRxValue(recordsRx);
  const add = useAddRecord();
  const cases = CASES;
  const entries = [...TIME_ENTRIES, ...records.timeEntries];

  // Everyone who can carry a matter: the advocates, plus the assistants and
  // clerks who log research and admin time against one.
  const people = [
    ...new Set([...ADVOCATES, ...STAFF.map((member) => member.name)]),
  ];

  function logTime(fields: FormData) {
    const start = text(fields, "start");
    const end = text(fields, "end");

    add("timeEntries", {
      id: nextId(entries),
      case: text(fields, "case"),
      lawyer: text(fields, "lawyer"),
      activity: text(fields, "activity") as TimeActivity,
      start,
      end,
      // Derived rather than typed in: the ledger and the invoice built from it
      // should never disagree with the clock.
      hours: hoursBetween(start, end),
      billable: text(fields, "billable") === "billable",
    });
  }

  return (
    <FormDialog
      title="Log time"
      lede="Hours are worked out from the start and end times, and billed to the matter you pick."
      trigger="Log time"
      triggerIcon="ph-duotone ph-timer"
      submitLabel="Log entry"
      onSubmit={logTime}
    >
      <SelectField
        wide
        label="Case"
        name="case"
        required
        defaultValue=""
        placeholder="Select a case"
        options={[
          ...cases.map((legalCase) => ({
            value: legalCase.number,
            label: `${legalCase.number} — ${legalCase.title}`,
          })),
          { value: "—", label: "No case (firm admin)" },
        ]}
      />
      <SelectField
        label="Fee earner"
        name="lawyer"
        required
        defaultValue=""
        placeholder="Select a person"
        options={people}
      />
      <SelectField
        label="Activity"
        name="activity"
        required
        defaultValue=""
        placeholder="Select an activity"
        options={TIME_ACTIVITIES}
      />
      <TextField label="Start" name="start" type="time" required />
      <TextField
        label="End"
        name="end"
        type="time"
        required
        hint="Rounded to the nearest quarter hour."
      />
      <SegmentedField
        wide
        label="Billing"
        name="billable"
        defaultValue="billable"
        options={[
          { value: "billable", label: "Billable" },
          { value: "non-billable", label: "Non-billable" },
        ]}
      />
    </FormDialog>
  );
}
