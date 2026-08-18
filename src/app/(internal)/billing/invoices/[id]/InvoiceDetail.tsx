import { InvoiceStatusTag, MarkPaidButton } from "./InvoiceStatusPanel";
import { BackLink, TableWrap } from "@/components/ui";
import { kes } from "@/lib/format";
import type { Invoice } from "@/lib/types";

export function InvoiceDetail({ invoice }: { invoice: Invoice }) {
  return (
    <>
      <BackLink href="/billing">Back to billing</BackLink>

      <div className="detail-head">
        <div>
          <h1 className="detail-title">Invoice {invoice.number}</h1>
          <div className="dek">
            {invoice.client} · {invoice.case} · payable by {invoice.method}
          </div>
        </div>
        <InvoiceStatusTag invoice={invoice} />
      </div>

      <TableWrap>
        <table className="table" style={{ marginTop: "var(--space-4)" }}>
          <thead>
            <tr>
              <th>Description</th>
              <th>Qty</th>
              <th>Rate</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lineItems.map((item) => (
              <tr key={item.desc}>
                <td>{item.desc}</td>
                <td>{item.qty}</td>
                <td>{kes(item.rate)}</td>
                <td>{kes(item.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>

      <div className="total-line">Total: {kes(invoice.amount)}</div>

      <MarkPaidButton invoice={invoice} />
    </>
  );
}
