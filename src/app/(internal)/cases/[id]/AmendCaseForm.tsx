"use client";

import { ActionDialog } from "@/components/ActionDialog";
import { Checkbox, SelectField, TextField } from "@/components/form";
import { MATTER_TYPES } from "@/domain/case/case";
import { LIMITATION_BASES } from "@/domain/case/limitation";
import type { CaseFile } from "@/services/case-service";
import { amendCase } from "../actions";
import { COURT_OPTIONS, keyFor } from "../courts";
import { dateInputValue } from "../display";

/**
 * Editing a matter's particulars.
 *
 * Every control opens on the stored value, so a submission that changes one
 * field resubmits the rest unchanged — which is what makes "absent means leave
 * alone" safe to rely on in `AmendMatter` rather than merely true.
 *
 * The client is not editable and the status is not here. Reassigning a matter
 * to a different client is not an edit; it would detach every invoice and trust
 * movement already raised against it. The status moves through the panel beside
 * this button, which enforces the state machine.
 *
 * `amendCase` needs the matter id, which `useActionState` has no way to pass,
 * so it is bound here. `bind` sends the id as part of the action's closure —
 * the server still decodes it, because a Server Action is reachable by direct
 * POST and a bound argument is not a trusted one.
 */
export function AmendCaseForm({ file }: { file: CaseFile }) {
  const { matter } = file;

  return (
    <ActionDialog
      title="Amend the matter"
      lede="Corrections to the file. The status moves through the lifecycle, not through this form."
      trigger="Amend particulars"
      triggerIcon="ph-duotone ph-pencil-simple"
      triggerVariant="btn-secondary"
      submitLabel="Save changes"
      pendingLabel="Saving…"
      action={amendCase.bind(null, matter.id)}
    >
      {(state) => {
        /**
         * What was typed, falling back to what is stored.
         *
         * React clears an uncontrolled form once the action returns, so a
         * refusal over one field would otherwise revert the other nine to the
         * stored record and lose every other edit in the same submission.
         */
        const kept = (name: string, stored: string) =>
          state.values[name] ?? stored;

        return (
          <>
            <TextField
              wide
              label="Case title"
              name="title"
              required
              defaultValue={kept("title", matter.title)}
              error={state.fields["title"]}
            />
            <SelectField
              label="Matter type"
              name="type"
              required
              defaultValue={kept("type", matter.type)}
              options={[...MATTER_TYPES]}
              error={state.fields["type"]}
            />
            <SelectField
              label="Assigned advocate"
              name="advocateId"
              required
              defaultValue={kept("advocateId", matter.advocateId)}
              options={[{ value: file.advocate.id, label: file.advocate.name }]}
              hint="Reassignment arrives with the staff module; this shows who carries it."
              error={state.fields["advocateId"]}
            />

            <SelectField
              label="Court"
              name="court"
              defaultValue={kept("court", keyFor(matter.court))}
              placeholder="Not filed in a court on the list"
              options={COURT_OPTIONS}
              error={state.fields["court"]}
            />
            <TextField
              label="Filed in court"
              name="filedOn"
              type="date"
              defaultValue={kept("filedOn", dateInputValue(matter.filedOn))}
              hint="Setting this is the act of filing, and needs a current practising certificate."
              error={state.fields["filedOn"]}
            />
            <TextField
              label="Cause number"
              name="causeNumber"
              defaultValue={kept("causeNumber", matter.causeNumber ?? "")}
              placeholder="e.g. MCCC E0412 of 2026"
              error={state.fields["causeNumber"]}
            />

            <TextField
              label="Claim value (KES)"
              name="claimValueShillings"
              type="number"
              min={0}
              step="0.01"
              defaultValue={kept(
                "claimValueShillings",
                matter.claimValueCents === undefined
                  ? ""
                  : String(matter.claimValueCents / 100),
              )}
              hint="Blank where the matter has no pecuniary value."
              error={state.fields["claimValueShillings"]}
            />
            <div className="field">
              <span className="field-legend">Customary law</span>
              <div className="check-row">
                <Checkbox
                  name="underCustomaryLaw"
                  label="Claim arises under customary law"
                  defaultChecked={
                    state.status === "refused"
                      ? state.values["underCustomaryLaw"] === "on"
                      : matter.underCustomaryLaw
                  }
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
              defaultValue={kept("accruedOn", dateInputValue(matter.accruedOn))}
              error={state.fields["accruedOn"]}
            />
            <SelectField
              label="Limitation basis"
              name="limitationBasis"
              defaultValue={kept(
                "limitationBasis",
                matter.limitationBasis ?? "",
              )}
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
