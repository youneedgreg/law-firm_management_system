"use client";

import Link from "next/link";
import { useRxValue } from "@effect-rx/rx-react";
import { useInvoiceStatus } from "@/rx/hooks";
import { recordsRx } from "@/rx/session";
import { Stat, TableWrap } from "@/components/ui";
import { INVOICES, TRUST_ON_HAND } from "@/lib/data/billing";
import { invoiceStatusTag, kes } from "@/lib/format";

/**
 * Billing reads the invoice-status overrides, so the totals and the ledger
 * both move the moment a payment is recorded anywhere in the app.
 */
export function BillingStats() {
  const records = useRxValue(recordsRx);
  const statusOf = useInvoiceStatus();

  const invoices = [...records.invoices, ...INVOICES];
  const billed = invoices.reduce((total, invoice) => total + invoice.amount, 0);
  const collected = invoices
    .filter((invoice) => statusOf(invoice) === "Paid")
    .reduce((total, invoice) => total + invoice.amount, 0);

  return (
    <div className="stat-grid" style={{ marginBottom: "var(--space-6)" }}>
      <Stat label="Total billed" value={kes(billed)} small />
      <Stat label="Collected" value={kes(collected)} tone="accent" small />
      <Stat
        label="Outstanding"
        value={kes(billed - collected)}
        tone="accent-2"
        small
      />
      <Stat label="Trust on hand" value={kes(TRUST_ON_HAND)} small />
    </div>
  );
}

export function InvoiceTable() {
  const records = useRxValue(recordsRx);
  const statusOf = useInvoiceStatus();
  const invoices = [...records.invoices, ...INVOICES];

  return (
    <TableWrap>
      <table className="table">
        <thead>
          <tr>
            <th>Invoice #</th>
            <th>Client</th>
            <th>Case</th>
            <th>Amount</th>
            <th>Method</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice) => {
            const status = statusOf(invoice);
            return (
              <tr key={invoice.id}>
                <td>{invoice.number}</td>
                <td>{invoice.client}</td>
                <td>{invoice.case}</td>
                <td>{kes(invoice.amount)}</td>
                <td>{invoice.method}</td>
                <td>
                  <span className={invoiceStatusTag(status)}>{status}</span>
                </td>
                <td className="cell-action">
                  <Link
                    href={`/billing/invoices/${invoice.id}`}
                    className="btn btn-ghost"
                  >
                    Open
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableWrap>
  );
}
