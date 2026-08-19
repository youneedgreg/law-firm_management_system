"use client";

import { useInvoiceStatus, useMarkPaid } from "@/rx/hooks";
import { invoiceStatusTag } from "@/lib/format";
import type { Invoice } from "@/lib/types";

export function InvoiceStatusTag({ invoice }: { invoice: Invoice }) {
  const statusOf = useInvoiceStatus();
  const status = statusOf(invoice);
  return <span className={invoiceStatusTag(status)}>{status}</span>;
}

export function MarkPaidButton({ invoice }: { invoice: Invoice }) {
  const statusOf = useInvoiceStatus();
  const markPaid = useMarkPaid();

  if (statusOf(invoice) === "Paid") {
    return (
      <p className="dek">
        <i className="ph-duotone ph-check-circle" aria-hidden /> Settled in full
        — recorded against {invoice.method}.
      </p>
    );
  }

  return (
    <button
      type="button"
      className="btn btn-primary"
      onClick={() => markPaid(invoice.id)}
    >
      Mark as paid
    </button>
  );
}
