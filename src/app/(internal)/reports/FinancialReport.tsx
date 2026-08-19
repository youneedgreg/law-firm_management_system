"use client";

import { useInvoiceStatus } from "@/rx/hooks";
import {
  COLLECTIONS_THIS_MONTH,
  INVOICES,
  REVENUE_THIS_MONTH,
} from "@/lib/data/billing";
import { kes } from "@/lib/format";

/** Outstanding tracks live payment state, so this column runs on the client. */
export function FinancialReport() {
  const statusOf = useInvoiceStatus();

  const outstanding = INVOICES.filter(
    (invoice) => statusOf(invoice) !== "Paid",
  ).reduce((total, invoice) => total + invoice.amount, 0);

  const lines = [
    `Revenue this month: ${kes(REVENUE_THIS_MONTH)}`,
    `Outstanding invoices: ${kes(outstanding)}`,
    `Collections this month: ${kes(COLLECTIONS_THIS_MONTH)}`,
  ];

  return (
    <>
      {lines.map((line) => (
        <div className="line-muted" key={line}>
          {line}
        </div>
      ))}
    </>
  );
}
