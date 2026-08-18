"use client";

import { useAppState } from "@/components/AppState";
import { FormDialog } from "@/components/FormDialog";
import { SelectField, TextField } from "@/components/form";
import { ADVOCATES, CASES, courts, practiceAreas } from "@/lib/data/cases";
import { CLIENTS } from "@/lib/data/clients";
import { displayDate } from "@/lib/format";
import { nextId, number, text } from "@/lib/forms";
import {
  CASE_STATUSES,
  CASE_TYPES,
  type CaseStatus,
  type CaseType,
} from "@/lib/types";

/** Opening a matter: section 4 of the spec's Cases table, as a form. */
export function NewCaseForm() {
  const { records, add } = useAppState();
  const clients = [...CLIENTS, ...records.clients];
  const cases = [...CASES, ...records.cases];

  function createCase(fields: FormData) {
    const id = nextId(cases);
    const advocate = text(fields, "advocate");
    const filed = displayDate(text(fields, "filed"));

    add("cases", {
      id,
      number: `OKL-${new Date().getFullYear()}-${String(id).padStart(3, "0")}`,
      title: text(fields, "title"),
      type: text(fields, "type") as CaseType,
      practiceArea: text(fields, "practiceArea"),
      court: text(fields, "court"),
      judge: text(fields, "judge") || "To be assigned",
      opposingCounsel: text(fields, "opposingCounsel") || "Not on record",
      filed,
      status: text(fields, "status") as CaseStatus,
      clientId: number(fields, "clientId"),
      advocate,
      timeline: [
        { date: filed, text: `Case opened and assigned to ${advocate}` },
      ],
      notes: [],
      hearings: [],
      documents: [],
      invoices: [],
    });
  }

  return (
    <FormDialog
      title="Open a new case"
      lede="The matter is filed against a client on record and assigned to the advocate who will carry it."
      trigger="New case"
      triggerIcon="ph-duotone ph-plus"
      submitLabel="Open case"
      onSubmit={createCase}
    >
      <TextField
        wide
        label="Case title"
        name="title"
        required
        placeholder="e.g. Wanjiku Mwangi v. Nairobi Metro SACCO"
      />
      <SelectField
        label="Client"
        name="clientId"
        required
        defaultValue=""
        placeholder="Select a client"
        options={clients.map((client) => ({
          value: String(client.id),
          label: client.name,
        }))}
      />
      <SelectField
        label="Case type"
        name="type"
        required
        defaultValue=""
        placeholder="Select a type"
        options={CASE_TYPES}
      />
      <SelectField
        label="Practice area"
        name="practiceArea"
        required
        defaultValue=""
        placeholder="Select an area"
        options={practiceAreas()}
      />
      <SelectField
        label="Court"
        name="court"
        required
        defaultValue=""
        placeholder="Select a court"
        options={courts()}
      />
      <TextField label="Presiding judge" name="judge" placeholder="Hon. J. Kimani" />
      <TextField
        label="Opposing counsel"
        name="opposingCounsel"
        placeholder="Firm or advocate on the other side"
      />
      <TextField label="Date filed" name="filed" type="date" required />
      <SelectField
        label="Status"
        name="status"
        defaultValue="New"
        options={CASE_STATUSES}
      />
      <SelectField
        wide
        label="Assigned advocate"
        name="advocate"
        required
        defaultValue=""
        placeholder="Select an advocate"
        options={ADVOCATES}
        hint="The advocate whose caseload this matter joins."
      />
    </FormDialog>
  );
}
