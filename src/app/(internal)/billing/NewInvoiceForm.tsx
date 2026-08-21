"use client";

import { useState } from "react";
import { ActionDialog } from "@/components/ActionDialog";
import { SelectField, TextField } from "@/components/form";
import type { BillingChoices } from "@/services/billing-service";
import { raiseInvoice } from "./actions";

/**
 * Raising a fee note.
 *
 * The clients and matters are the firm's own, read on the server by the page
 * and handed down as a prop. That is the opposite of the caseload's intake
 * dialog, which fetches its choices from an atom, and the difference is
 * traffic: most visits to the caseload never open the intake form, whereas
 * somebody on the billing screen holding `invoice:write` is usually there to
 * raise one. Fetching a list the page already had would be a round trip for
 * nothing.
 *
 * `number` is not on the form and never will be. It is derived from every fee
 * note already issued, which is also why raising two at once is a race the
 * service retries rather than a field somebody could get wrong.
 *
 * ## One line, stated as a limitation
 *
 * A fee note can carry many lines and the domain and the API both accept them.
 * This form offers one, because the realistic way a multi-line fee note gets
 * built is from recorded time — which is the next slice — and a dynamic line
 * editor written now would be deleted when it lands.
 */
export function NewInvoiceForm({ choices }: { choices: BillingChoices }) {
  /**
   * Today, and thirty days on — the firm's usual terms.
   *
   * Both derived from one reading of the clock rather than two. Two readings
   * either side of midnight would issue a fee note dated yesterday and due in
   * thirty-one days, which is the kind of defect that is impossible to
   * reproduce and trivial to avoid.
   */
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const inThirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  /**
   * The matter list narrows to the chosen client.
   *
   * A fee note raised against one client and a matter belonging to another is
   * not something the domain forbids — `caseId` is just a foreign key — and it
   * is nonetheless always a mistake. Narrowing the list is a UI affordance and
   * not a control, which is why the state lives here and no rule was added
   * anywhere else to match it.
   */
  const [clientId, setClientId] = useState("");
  const matters =
    clientId === ""
      ? choices.matters
      : choices.matters.filter((matter) => matter.clientId === clientId);

  return (
    <ActionDialog
      title="Raise a fee note"
      lede="Billed to a client, optionally against one matter. The number is assigned from what the firm has already issued."
      trigger="New invoice"
      triggerIcon="ph-duotone ph-file-plus"
      submitLabel="Raise fee note"
      pendingLabel="Raising…"
      action={raiseInvoice}
    >
      {(state) => {
        const kept = (name: string, fallback = "") =>
          state.values[name] ?? fallback;

        return (
          <>
            <SelectField
              label="Client"
              name="clientId"
              required
              defaultValue={kept("clientId")}
              placeholder="Select a client"
              options={choices.clients.map((client) => ({
                value: client.id,
                label: client.name,
              }))}
              error={state.fields["clientId"]}
              onChange={(event) => setClientId(event.target.value)}
            />
            <SelectField
              label="Matter"
              name="caseId"
              defaultValue={kept("caseId")}
              placeholder="No matter"
              options={matters.map((matter) => ({
                value: matter.id,
                label: `${matter.number} — ${matter.title}`,
              }))}
              hint="Leave blank for general advice not tied to a file."
              error={state.fields["caseId"]}
            />

            <TextField
              label="Issued"
              name="issuedOn"
              type="date"
              required
              defaultValue={kept("issuedOn", today)}
              error={state.fields["issuedOn"]}
            />
            <TextField
              label="Due"
              name="dueOn"
              type="date"
              required
              defaultValue={kept("dueOn", inThirtyDays)}
              hint="The status derives from this: past it and unpaid is Overdue."
              error={state.fields["dueOn"]}
            />

            <TextField
              wide
              label="Description"
              name="description"
              required
              placeholder="e.g. Professional fees — drafting and filing"
              defaultValue={kept("description")}
              error={state.fields["description"]}
            />
            <TextField
              label="Quantity"
              name="quantity"
              type="number"
              min="0"
              step="0.25"
              required
              defaultValue={kept("quantity", "1")}
              hint="Hours, or 1 for a fixed fee."
              error={state.fields["quantity"]}
            />
            <TextField
              label="Unit price (KES)"
              name="unitPrice"
              type="number"
              min="0"
              step="0.01"
              required
              defaultValue={kept("unitPrice")}
              placeholder="15000"
              error={state.fields["unitPrice"]}
            />
          </>
        );
      }}
    </ActionDialog>
  );
}
