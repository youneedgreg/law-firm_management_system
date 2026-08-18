import { notFound } from "next/navigation";
import { InvoiceStatusTag, MarkPaidButton } from "./InvoiceStatusPanel";
import { BackLink, TableWrap } from "@/components/ui";
import { INVOICES, getInvoice } from "@/lib/data/billing";
import { kes } from "@/lib/format";

export function generateStaticParams() {
  return INVOICES.map((invoice) => ({ id: String(invoice.id) }));
}

export default async function InvoiceDetailPage({
  params,
}: PageProps<"/billing/invoices/[id]">) {
  const { id } = await params;
  const invoice = getInvoice(Number(id));
  if (!invoice) notFound();

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
