"use client";

import { useAppState } from "@/components/AppState";
import { FormDialog } from "@/components/FormDialog";
import { SelectField, TextField } from "@/components/form";
import { INVOICES } from "@/lib/data/billing";
import { CASES } from "@/lib/data/cases";
import { CLIENTS } from "@/lib/data/clients";
import { nextId, number, text } from "@/lib/forms";
import {
  INVOICE_STATUSES,
  PAYMENT_METHODS,
  type InvoiceStatus,
  type PaymentMethod,
} from "@/lib/types";

/** Raising a fee note: one line item, priced by quantity × rate. */
export function NewInvoiceForm() {
  const { records, add } = useAppState();
  const clients = [...records.clients, ...CLIENTS];
  const cases = CASES;
  const invoices = [...INVOICES, ...records.invoices];

  function createInvoice(fields: FormData) {
    const id = nextId(invoices);
    const description = text(fields, "description");
    const quantity = number(fields, "quantity", 1);
    const rate = number(fields, "rate");
    const amount = Math.round(quantity * rate);

    add("invoices", {
      id,
      number: `INV-${3000 + id}`,
      client: text(fields, "client"),
      case: text(fields, "case"),
      amount,
      method: text(fields, "method") as PaymentMethod,
      status: text(fields, "status") as InvoiceStatus,
      lineItems: [{ desc: description, qty: quantity, rate, amount }],
    });
  }

  return (
    <FormDialog
      title="Raise an invoice"
      lede="The fee note is billed to a client against one matter; the amount is the quantity times the rate."
      trigger="New invoice"
      triggerIcon="ph-duotone ph-file-plus"
      submitLabel="Raise invoice"
      onSubmit={createInvoice}
    >
      <SelectField
        label="Client"
        name="client"
        required
        defaultValue=""
        placeholder="Select a client"
        options={clients.map((client) => client.name)}
      />
      <SelectField
        label="Case"
        name="case"
        required
        defaultValue=""
        placeholder="Select a case"
        options={cases.map((legalCase) => ({
          value: legalCase.number,
          label: `${legalCase.number} — ${legalCase.title}`,
        }))}
      />
      <TextField
        wide
        label="Description"
        name="description"
        required
        placeholder="e.g. Professional fees — drafting and filing"
      />
      <TextField
        label="Quantity"
        name="quantity"
        type="number"
        min="0"
        step="0.25"
        defaultValue="1"
        required
        hint="Hours, or 1 for a fixed fee."
      />
      <TextField
        label="Rate (KES)"
        name="rate"
        type="number"
        min="0"
        step="500"
        required
        placeholder="15000"
      />
      <SelectField
        label="Payment method"
        name="method"
        defaultValue="M-Pesa"
        options={PAYMENT_METHODS}
      />
      <SelectField
        label="Status"
        name="status"
        defaultValue="Issued"
        options={INVOICE_STATUSES}
      />
    </FormDialog>
  );
}
