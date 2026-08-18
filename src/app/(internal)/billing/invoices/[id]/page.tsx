import { CreatedInvoice } from "./CreatedInvoice";
import { InvoiceDetail } from "./InvoiceDetail";
import { INVOICES, getInvoice } from "@/lib/data/billing";

export function generateStaticParams() {
  return INVOICES.map((invoice) => ({ id: String(invoice.id) }));
}

export default async function InvoiceDetailPage({
  params,
}: PageProps<"/billing/invoices/[id]">) {
  const { id } = await params;
  const invoice = getInvoice(Number(id));

  // Outside the seed data, the invoice was raised in this browser session.
  if (!invoice) return <CreatedInvoice id={Number(id)} />;

  return <InvoiceDetail invoice={invoice} />;
}
