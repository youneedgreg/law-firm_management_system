import * as Billing from "@/domain/billing/invoice";
import * as Money from "@/domain/shared/money";
import { BackLink, Empty, TableWrap } from "@/components/ui";
import { feeNoteStatusTag } from "@/lib/format";
import type { FeeNote } from "@/services/billing-service";
import { PaymentPanel } from "./PaymentPanel";

/**
 * A fee note, as a document.
 *
 * Every figure on this page is derived on read — the line amounts, the total,
 * what has been paid, what is outstanding, and the status. None of them is
 * stored, which is what makes it impossible for the total at the bottom to
 * disagree with the lines above it. That is not a theoretical nicety: "the
 * invoice says 480,000 and the lines add to 460,000" is the exact defect that
 * makes a fee dispute unwinnable.
 */
export function InvoiceDetail({
  feeNote,
  mayRecordPayment,
  mayMoveMoney,
}: {
  feeNote: FeeNote;
  mayRecordPayment: boolean;
  mayMoveMoney: boolean;
}) {
  const { view } = feeNote;
  const { invoice } = view;

  return (
    <>
      <BackLink href="/billing">Back to billing</BackLink>

      <div className="detail-head">
        <div>
          <h1 className="detail-title">Fee note {invoice.number}</h1>
          <div className="dek">
            {feeNote.clientName}
            {feeNote.matterNumber === undefined
              ? " · no matter"
              : ` · ${feeNote.matterNumber}`}{" "}
            · issued {invoice.issuedOn.toLocaleDateString("en-KE")} · due{" "}
            {invoice.dueOn.toLocaleDateString("en-KE")}
          </div>
        </div>
        <span className={feeNoteStatusTag(view.status)}>
          {view.status}
          {view.daysOverdue > 0 ? ` · ${view.daysOverdue}d` : ""}
        </span>
      </div>

      <TableWrap>
        <table className="table" style={{ marginTop: "var(--space-4)" }}>
          <thead>
            <tr>
              <th>Description</th>
              <th>Qty</th>
              <th>Unit price</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line, index) => (
              <tr key={`${line.description}-${String(index)}`}>
                <td>{line.description}</td>
                <td>{line.quantityHundredths / 100}</td>
                <td>{Money.format(Money.fromCents(line.unitPriceCents))}</td>
                <td>{Money.format(Billing.lineAmount(line))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>

      <div className="total-line">Total: {Money.format(view.total)}</div>

      <h2 className="section-title section-title-spaced">Payments</h2>
      {invoice.payments.length === 0 ? (
        <Empty>Nothing has been paid against this fee note.</Empty>
      ) : (
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th>Received</th>
                <th>Method</th>
                <th>Reference</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.payments.map((payment, index) => (
                <tr
                  key={`${payment.receivedOn.toISOString()}-${String(index)}`}
                >
                  <td>{payment.receivedOn.toLocaleDateString("en-KE")}</td>
                  <td>{payment.method}</td>
                  <td>{payment.reference ?? "—"}</td>
                  <td>{Money.format(Money.fromCents(payment.amountCents))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}

      <div className="total-line">
        {Money.isNegative(view.outstanding)
          ? `Overpaid by ${Money.format(Money.negate(view.outstanding))}`
          : `Outstanding: ${Money.format(view.outstanding)}`}
      </div>

      <PaymentPanel
        invoiceId={invoice.id}
        outstanding={view.outstanding}
        heldOnTrust={feeNote.heldOnTrust}
        mayRecordPayment={mayRecordPayment}
        mayMoveMoney={mayMoveMoney}
      />
    </>
  );
}
