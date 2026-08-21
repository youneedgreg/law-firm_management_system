"use client";

import { Result, useRxValue } from "@effect-rx/rx-react";
import { ActionDialog } from "@/components/ActionDialog";
import {
  Checkbox,
  SelectField,
  TextAreaField,
  TextField,
} from "@/components/form";
import { MATTER_TYPES } from "@/domain/case/case";
import { LIMITATION_BASES } from "@/domain/case/limitation";
import { intakeChoicesRx } from "@/rx/cases";
import { explain } from "@/rx/failure";
import { openCase } from "./actions";
import { COURT_OPTIONS } from "./courts";

/**
 * Opening a matter.
 *
 * The choices are the firm's actual clients and actual staff, read through
 * `CaseService.intakeChoices()` — never a seed array. They arrive from an atom
 * rather than a prop, which is the difference between fetching them on every
 * render of the caseload and fetching them when this dialog is first opened.
 * Most visits to the caseload never open it.
 *
 * The selects render before the read finishes, empty and labelled as still
 * loading, rather than the dialog withholding itself until it can be complete.
 * A form whose trigger does nothing for half a second reads as broken; one
 * whose two dropdowns fill in a moment later reads as loading.
 *
 * Nothing is decided here. The advocates who cannot file are labelled, not
 * removed, because a matter can perfectly well be assigned to a legal assistant
 * so long as it is not being filed today — and which of those it is depends on
 * whether a filing date was entered, which is the service's judgement to make on
 * submission, not the form's to guess as you type.
 *
 * `id`, `number` and `status` are not on the form and never will be. The
 * reference is derived from the firm's existing matters, and a new file is New.
 */
export function NewCaseForm() {
  const today = new Date().toISOString().slice(0, 10);
  const result = useRxValue(intakeChoicesRx);

  const choices = Result.getOrElse(result, () => ({
    clients: [],
    advocates: [],
  }));

  const unavailable = Result.builder(result)
    .onError(explain)
    .orElse(() => "");

  return (
    <ActionDialog
      title="Open a new case"
      lede="The matter is opened against a client on record and assigned to the advocate who will carry it."
      trigger="New case"
      triggerIcon="ph-duotone ph-plus"
      submitLabel="Open case"
      pendingLabel="Opening…"
      action={openCase}
    >
      {(state) => {
        /**
         * What was typed, or the field's own default on a first open.
         *
         * React clears an uncontrolled form once the action returns, so without
         * this a refusal over one field would empty the other nine.
         */
        const kept = (name: string, fallback = "") =>
          state.values[name] ?? fallback;

        return (
          <>
            <TextField
              wide
              label="Case title"
              name="title"
              required
              placeholder="e.g. Wanjiku Mwangi v. Nairobi Metro SACCO"
              defaultValue={kept("title")}
              error={state.fields["title"]}
            />
            <SelectField
              label="Client"
              name="clientId"
              required
              defaultValue={kept("clientId")}
              placeholder={
                Result.isSuccess(result)
                  ? "Select a client"
                  : "Loading clients…"
              }
              options={choices.clients.map((client) => ({
                value: client.id,
                label: client.name,
              }))}
              error={state.fields["clientId"] ?? unavailable}
            />
            <TextAreaField
              wide
              label="Other side"
              name="opposingParties"
              rows={2}
              defaultValue={kept("opposingParties")}
              placeholder="One party per line"
              hint="Who the client is against. Searched by the conflict screen; blank is correct for a conveyance or a probate application."
              error={state.fields["opposingParties"]}
            />
            <SelectField
              label="Matter type"
              name="type"
              required
              defaultValue={kept("type")}
              placeholder="Select a type"
              options={[...MATTER_TYPES]}
              error={state.fields["type"]}
            />
            <SelectField
              wide
              label="Assigned advocate"
              name="advocateId"
              required
              defaultValue={kept("advocateId")}
              placeholder={
                Result.isSuccess(result)
                  ? "Select an advocate"
                  : "Loading staff…"
              }
              options={choices.advocates.map((advocate) => ({
                value: advocate.id,
                label: advocate.mayFile
                  ? `${advocate.name} — ${advocate.role}`
                  : `${advocate.name} — ${advocate.role} (may not file)`,
              }))}
              hint="Only an advocate holding a current practising certificate may file in court."
              error={state.fields["advocateId"]}
            />

            <TextField
              label="File opened"
              name="openedOn"
              type="date"
              required
              defaultValue={kept("openedOn", today)}
              error={state.fields["openedOn"]}
            />
            <TextField
              label="Filed in court"
              name="filedOn"
              type="date"
              defaultValue={kept("filedOn")}
              hint="Leave blank until the matter is lodged."
              error={state.fields["filedOn"]}
            />

            <SelectField
              label="Court"
              name="court"
              defaultValue={kept("court")}
              placeholder="Not yet filed"
              options={COURT_OPTIONS}
              error={state.fields["court"]}
            />
            <TextField
              label="Cause number"
              name="causeNumber"
              defaultValue={kept("causeNumber")}
              placeholder="e.g. MCCC E0412 of 2026"
              hint="Assigned by the court on filing."
              error={state.fields["causeNumber"]}
            />

            <TextField
              label="Claim value (KES)"
              name="claimValueShillings"
              type="number"
              min={0}
              step="0.01"
              defaultValue={kept("claimValueShillings")}
              placeholder="e.g. 4200000"
              hint="Leave blank where the matter has no pecuniary value."
              error={state.fields["claimValueShillings"]}
            />
            <div className="field">
              <span className="field-legend">Customary law</span>
              <div className="check-row">
                <Checkbox
                  name="underCustomaryLaw"
                  label="Claim arises under customary law"
                  defaultChecked={kept("underCustomaryLaw") === "on"}
                />
              </div>
              <p className="field-hint">
                Exempt from the magistrates&rsquo; pecuniary limit (s. 7(3)).
              </p>
            </div>

            <TextField
              label="Cause of action accrued"
              name="accruedOn"
              type="date"
              defaultValue={kept("accruedOn")}
              hint="When the limitation clock started running."
              error={state.fields["accruedOn"]}
            />
            <SelectField
              label="Limitation basis"
              name="limitationBasis"
              defaultValue={kept("limitationBasis")}
              placeholder="Not applicable"
              options={[...LIMITATION_BASES]}
              error={state.fields["limitationBasis"]}
            />
          </>
        );
      }}
    </ActionDialog>
  );
}
