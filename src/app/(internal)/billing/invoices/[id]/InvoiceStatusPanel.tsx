"use client";

import { useAppState } from "@/components/AppState";
import { invoiceStatusTag } from "@/lib/format";
import type { Invoice } from "@/lib/types";

export function InvoiceStatusTag({ invoice }: { invoice: Invoice }) {
  const { statusOf } = useAppState();
  const status = statusOf(invoice);
  return <span className={invoiceStatusTag(status)}>{status}</span>;
}

export function MarkPaidButton({ invoice }: { invoice: Invoice }) {
  const { statusOf, markPaid } = useAppState();

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
