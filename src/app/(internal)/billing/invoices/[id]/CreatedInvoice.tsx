"use client";

import { InvoiceDetail } from "./InvoiceDetail";
import { useRxValue } from "@effect-rx/rx-react";
import { hydratedRx, recordsRx } from "@/rx/session";
import { NotOnFile } from "@/components/ui";

/** A fee note raised through the invoice form, held in the session store. */
export function CreatedInvoice({ id }: { id: number }) {
  const records = useRxValue(recordsRx);
  const hydrated = useRxValue(hydratedRx);

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
