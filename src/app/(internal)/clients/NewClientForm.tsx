"use client";

import { useState } from "react";
import { ActionDialog } from "@/components/ActionDialog";
import { SegmentedField, TextField } from "@/components/form";
import { takeOnClient } from "./actions";

/**
 * Taking a client on.
 *
 * The `_tag` segmented control is not a cosmetic filter over one set of fields:
 * it chooses which half of the `Client` union is being created, and the
 * corporate half **must** name somebody who can instruct. `Corporate.contacts`
 * is a `NonEmptyArray`, so a company with nobody authorised is unrepresentable
 * — this form is where that becomes visible, by showing the contact fields only
 * when they are required and always requiring them when shown.
 *
 * One contact at intake. Further contacts are an amendment: a repeating
 * fieldset here would be machinery for something that is rare at the moment a
 * file is opened and ordinary six months later.
 *
 * There is no conflict-check step inside this form. That is its own act, in its
 * own dialog, performed *before* deciding whether to act at all — see
 * `ConflictScreen`.
 */
export function NewClientForm() {
  const today = new Date().toISOString().slice(0, 10);
  const [kind, setKind] = useState<"Individual" | "Corporate">("Individual");

  return (
    <ActionDialog
      title="Take on a client"
      lede="The client number is assigned from what the firm has already issued."
      trigger="New client"
      triggerIcon="ph-duotone ph-user-plus"
      submitLabel="Take on"
      pendingLabel="Saving…"
      action={takeOnClient}
    >
      {(state) => {
        const kept = (name: string, fallback = "") =>
          state.values[name] ?? fallback;

        return (
          <>
            <SegmentedField
              wide
              label="Kind"
              name="_tag"
              defaultValue={kept("_tag", "Individual")}
              options={[
                { value: "Individual", label: "Individual" },
                { value: "Corporate", label: "Corporate" },
              ]}
              onChange={(chosen) => {
                if (chosen === "Individual" || chosen === "Corporate") {
                  setKind(chosen);
                }
              }}
            />

            <TextField
              wide
              label="Name"
              name="name"
              required
              defaultValue={kept("name")}
              placeholder={
                kind === "Corporate"
                  ? "e.g. Coastal Freight Ltd"
                  : "e.g. Peter Kariuki"
              }
              error={state.fields["name"]}
            />
            <TextField
              label="Email"
              name="email"
              type="email"
              required
              defaultValue={kept("email")}
              error={state.fields["email"]}
            />
            <TextField
              label="Telephone"
              name="phone"
              required
              defaultValue={kept("phone")}
              placeholder="0722 445 109"
              hint="Any Kenyan number; a switchboard landline is fine."
              error={state.fields["phone"]}
            />

            <TextField
              label="KRA PIN"
              name="kraPin"
              defaultValue={kept("kraPin")}
              placeholder={kind === "Corporate" ? "P051234876T" : "A004521987Z"}
              hint={
                kind === "Corporate"
                  ? "Entities hold a P PIN. An A PIN is accepted and queried, not refused."
                  : "Individuals hold an A PIN."
              }
              error={state.fields["kraPin"]}
            />
            <TextField
              label="Onboarded"
              name="onboardedOn"
              type="date"
              required
              defaultValue={kept("onboardedOn", today)}
              error={state.fields["onboardedOn"]}
            />

            {kind === "Corporate" ? (
              <>
                <TextField
                  label="Registration number"
                  name="registrationNumber"
                  defaultValue={kept("registrationNumber")}
                  placeholder="e.g. PVT-8XYZ4K"
                  error={state.fields["registrationNumber"]}
                />
                <TextField
                  label="Contact"
                  name="contactName"
                  required
                  defaultValue={kept("contactName")}
                  hint="A company cannot give instructions; a person does."
                  error={state.fields["contactName"]}
                />
                <TextField
                  label="Their role"
                  name="contactRole"
                  required
                  defaultValue={kept("contactRole")}
                  placeholder="e.g. Finance Director"
                  error={state.fields["contactRole"]}
                />
                <TextField
                  label="Their email"
                  name="contactEmail"
                  type="email"
                  defaultValue={kept("contactEmail")}
                  error={state.fields["contactEmail"]}
                />
              </>
            ) : null}
          </>
        );
      }}
    </ActionDialog>
  );
}
