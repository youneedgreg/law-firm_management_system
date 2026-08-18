"use client";

import { useAppState } from "@/components/AppState";
import { TableWrap } from "@/components/ui";
import { portalInvoices } from "@/lib/data/portal";
import { invoiceStatusTag, kes } from "@/lib/format";

/**
 * Paying here writes the same invoice-status override the firm's Billing screen
 * reads, so a client payment shows up on the internal ledger immediately.
 */
export default function PortalInvoicesPage() {
  const { statusOf, markPaid } = useAppState();
  const invoices = portalInvoices();

  return (
    <>
      <h2 style={{ fontSize: 28, margin: "0 0 var(--space-4)" }}>Invoices</h2>

      <TableWrap>
        <table className="table">
          <thead>
            <tr>
              <th>Invoice #</th>
              <th>Case</th>
              <th>Amount</th>
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
                  <td>{invoice.case}</td>
                  <td>{kes(invoice.amount)}</td>
                  <td>
                    <span className={invoiceStatusTag(status)}>{status}</span>
                  </td>
                  <td className="cell-action">
                    {status === "Paid" ? (
                      <span className="dek">Settled</span>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => markPaid(invoice.id)}
                      >
                        Pay now
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableWrap>
    </>
  );
}
