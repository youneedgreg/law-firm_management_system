"use client";

import { InvoiceDetail } from "./InvoiceDetail";
import { useAppState } from "@/components/AppState";
import { NotOnFile } from "@/components/ui";

/** A fee note raised through the invoice form, held in the session store. */
export function CreatedInvoice({ id }: { id: number }) {
  const { records, hydrated } = useAppState();

  if (!hydrated) return null;

  const invoice = records.invoices.find((entry) => entry.id === id);
  if (!invoice) {
    return (
      <NotOnFile backHref="/billing" backLabel="Back to billing">
        No invoice is filed under #{id}.
      </NotOnFile>
    );
  }

  return <InvoiceDetail invoice={invoice} />;
}
