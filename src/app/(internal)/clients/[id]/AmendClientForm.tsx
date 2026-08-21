"use client";

import { ActionDialog } from "@/components/ActionDialog";
import { TextField } from "@/components/form";
import type { Client } from "@/domain/client/client";
import { amendClient } from "../actions";

/**
 * Correcting a client's particulars.
 *
 * The kind is not on the form. An individual who turns out to be a company is
 * not a correction but a different client — switching would invalidate the KRA
 * PIN prefix, orphan the contacts, and leave every matter and fee note already
 * raised pointing at a record that no longer means what it did. The service
 * refuses it too; this simply does not offer it.
 */
export function AmendClientForm({ client }: { client: Client }) {
  const amend = amendClient.bind(null, client.id);

  return (
    <ActionDialog
      title={`Correct ${client.name}`}
      lede="Only the fields you change are written; the rest are left alone."
      trigger="Edit"
      triggerIcon="ph-duotone ph-pencil-simple"
      triggerVariant="btn-ghost"
      submitLabel="Save"
      pendingLabel="Saving…"
      action={amend}
    >
      {(state) => {
        const kept = (name: string, fallback = "") =>
          state.values[name] ?? fallback;

        return (
          <>
            <TextField
              wide
              label="Name"
              name="name"
              defaultValue={kept("name", client.name)}
              error={state.fields["name"]}
            />
            <TextField
              label="Email"
              name="email"
              type="email"
              defaultValue={kept("email", client.email)}
              error={state.fields["email"]}
            />
            <TextField
              label="Telephone"
              name="phone"
              defaultValue={kept("phone", client.phone)}
              error={state.fields["phone"]}
            />
            <TextField
              label="KRA PIN"
              name="kraPin"
              defaultValue={kept("kraPin", client.kraPin ?? "")}
              error={state.fields["kraPin"]}
            />
            {client._tag === "Corporate" ? (
              <TextField
                label="Registration number"
                name="registrationNumber"
                defaultValue={kept(
                  "registrationNumber",
                  client.registrationNumber ?? "",
                )}
                error={state.fields["registrationNumber"]}
              />
            ) : null}
          </>
        );
      }}
    </ActionDialog>
  );
}
