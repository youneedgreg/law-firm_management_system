"use client";

import { ActionDialog } from "@/components/ActionDialog";
import { SelectField, TextField } from "@/components/form";
import type { ClientId } from "@/domain/shared/ids";
import { recordDeposit } from "./actions";
import { constraintsOf } from "@/lib/form-constraints";
import { RecordDepositForm } from "./forms";

/** The constraints `RecordDepositForm` already carries. See `lib/form-constraints.ts`. */
const field = constraintsOf(RecordDepositForm);

/**
 * Receiving client money.
 *
 * The one money form with no failure to speak of, and the reason is Rule 4:
 * client money is paid into client account "without delay", and paying in can
 * never breach a balance. Everything that *can* be refused about client money —
 * Rule 10, the Rule 9 purposes — is on the way out, not the way in.
 *
 * It is still audited, and that is the point of it being a form at all rather
 * than something a bank feed does quietly. A deposit nobody is recorded as
 * having received is the first half of a misappropriation, and the trail is
 * what makes the second half visible.
 */
export function NewDepositForm({
  clients,
}: {
  clients: readonly { readonly id: ClientId; readonly name: string }[];
}) {
  const today = new Date().toISOString().slice(0, 10);

  return (
    <ActionDialog
      title="Receive client money"
      lede="Paid into client account and held on trust. It is the client's money until a fee note is settled against it."
      trigger="Record deposit"
      triggerIcon="ph-duotone ph-vault"
      triggerVariant="btn-ghost"
      submitLabel="Record deposit"
      pendingLabel="Recording…"
      action={recordDeposit}
    >
      {(state) => {
        const kept = (name: string, fallback = "") =>
          state.values[name] ?? fallback;

        return (
          <>
            <SelectField
              wide
              label="Client"
              name="clientId"
              {...field("clientId")}
              defaultValue={kept("clientId")}
              placeholder="Select a client"
              options={clients.map((client) => ({
                value: client.id,
                label: client.name,
              }))}
              error={state.fields["clientId"]}
            />
            <TextField
              label="Amount (KES)"
              name="amount"
              type="number"
              min="0"
              step="0.01"
              {...field("amount")}
              defaultValue={kept("amount")}
              placeholder="250000"
              error={state.fields["amount"]}
            />
            <TextField
              label="Received"
              name="receivedOn"
              type="date"
              {...field("receivedOn")}
              defaultValue={kept("receivedOn", today)}
              error={state.fields["receivedOn"]}
            />
            <TextField
              wide
              label="Reference"
              name="reference"
              {...field("reference")}
              defaultValue={kept("reference")}
              placeholder="e.g. Funds on account of costs"
              hint="What the deposit was for, as it should read on the ledger."
              error={state.fields["reference"]}
            />
          </>
        );
      }}
    </ActionDialog>
  );
}
