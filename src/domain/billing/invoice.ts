import { Either, Schema } from "effect";
import { CaseId, ClientId, InvoiceId } from "../shared/ids";
import * as Money from "../shared/money";

/**
 * Fee notes and their payment state.
 *
 * The organising principle is the same one the trust ledger uses: **nothing
 * that can be computed is stored**. An invoice total is the sum of its lines,
 * and its status is a function of what has been paid against it and what the
 * date is. Storing either invites the row and its own contents to disagree,
 * and "the total says 480,000 but the lines add to 460,000" is not a bug
 * anyone enjoys finding in a fee dispute.
 *
 * VAT is deliberately absent. Its treatment of fees versus disbursements is
 * an open question in docs/domain-notes.md §6, and a wrong VAT line on a
 * client invoice is worse than no VAT line on an internal prototype.
 */

// ── Lines ─────────────────────────────────────────────────────────────────

/**
 * One chargeable item.
 *
 * `quantity` is in hundredths, so 2.5 hours is `250`. Hours land on quarters
 * and thirds, and a float quantity multiplied by a cent amount reintroduces
 * exactly the rounding error `Money` exists to keep out.
 */
export const InvoiceLine = Schema.Struct({
  description: Schema.NonEmptyTrimmedString,
  quantityHundredths: Schema.Int.pipe(Schema.positive()),
  unitPriceCents: Schema.Int.pipe(Schema.nonNegative()),
});

export type InvoiceLine = typeof InvoiceLine.Type;

/** What a line comes to: unit price × quantity, rounded to the cent. */
export const lineAmount = (line: InvoiceLine): Money.Money =>
  Money.multiply(
    Money.fromCents(line.unitPriceCents),
    line.quantityHundredths / 100,
  );

// ── Payments ──────────────────────────────────────────────────────────────

export const PAYMENT_METHODS = [
  "M-Pesa",
  "Bank Transfer",
  "Cheque",
  "Cash",
  "Card",
] as const;

export const PaymentMethod = Schema.Literal(...PAYMENT_METHODS);
export type PaymentMethod = typeof PaymentMethod.Type;

export const Payment = Schema.Struct({
  amountCents: Schema.Int.pipe(Schema.positive()),
  method: PaymentMethod,
  receivedOn: Schema.DateFromSelf,
  /** M-Pesa code, cheque number, bank reference — whatever reconciles it. */
  reference: Schema.optional(Schema.String),
});

export type Payment = typeof Payment.Type;

// ── The invoice ───────────────────────────────────────────────────────────

export const Invoice = Schema.Struct({
  id: InvoiceId,
  number: Schema.String.pipe(Schema.pattern(/^INV-\d{4}$/)),
  clientId: ClientId,
  caseId: Schema.optional(CaseId),
  issuedOn: Schema.DateFromSelf,
  dueOn: Schema.DateFromSelf,
  lines: Schema.NonEmptyArray(InvoiceLine),
  payments: Schema.Array(Payment),
});

export type Invoice = typeof Invoice.Type;

/**
 * Lines are `NonEmptyArray` on purpose: an invoice with nothing on it is not
 * an invoice, and letting one exist means every consumer downstream has to
 * decide what a zero-line total means.
 */

export const total = (invoice: Invoice): Money.Money =>
  Money.sum(invoice.lines.map(lineAmount));

export const paid = (invoice: Invoice): Money.Money =>
  Money.sum(
    invoice.payments.map((payment) => Money.fromCents(payment.amountCents)),
  );

export const outstanding = (invoice: Invoice): Money.Money =>
  Money.subtract(total(invoice), paid(invoice));

// ── Status, derived ───────────────────────────────────────────────────────

export const INVOICE_STATUSES = [
  "Unpaid",
  "Partially Paid",
  "Paid",
  "Overdue",
  "Overpaid",
] as const;

export const InvoiceStatus = Schema.Literal(...INVOICE_STATUSES);
export type InvoiceStatus = typeof InvoiceStatus.Type;

/**
 * The invoice's state as at a given date.
 *
 * A function of the payments and the calendar, never a stored field — which
 * also means "overdue" cannot go stale overnight the way a persisted status
 * does. `asAt` is a parameter rather than `new Date()` so this stays pure and
 * testable; ambient time is the usual reason date logic can only be tested by
 * waiting.
 *
 * `Overpaid` is a real state, not an error. Clients round payments up and pay
 * twice, and an invoice that refuses to represent that forces the surplus to
 * be hidden somewhere worse. What happens next — refund, or credit against the
 * next fee note — is a decision for the firm, not for this function.
 */
export const status = (invoice: Invoice, asAt: Date): InvoiceStatus => {
  const due = outstanding(invoice);

  if (Money.isNegative(due)) return "Overpaid";
  if (Money.isZero(due)) return "Paid";
  if (asAt.getTime() > invoice.dueOn.getTime()) return "Overdue";
  return Money.isZero(paid(invoice)) ? "Unpaid" : "Partially Paid";
};

// ── Recording a payment ───────────────────────────────────────────────────

export class PaymentExceedsBalance extends Schema.TaggedError<PaymentExceedsBalance>()(
  "PaymentExceedsBalance",
  { outstanding: Schema.Number, offered: Schema.Number },
) {
  get reason(): string {
    return (
      `Payment of ${Money.format(this.offered as Money.Money)} exceeds the ` +
      `${Money.format(this.outstanding as Money.Money)} outstanding on this invoice`
    );
  }
}

/**
 * Applies a payment, refusing one that would overpay.
 *
 * The guard is a prompt rather than a prohibition: `Overpaid` exists as a
 * status precisely because overpayment happens. This refuses it at the point of
 * entry, where it is nearly always a typo or a double-posted M-Pesa
 * confirmation, while leaving the state representable for the cases where it
 * is real and has to be recorded deliberately.
 */
export const recordPayment = (
  invoice: Invoice,
  payment: Payment,
): Either.Either<Invoice, PaymentExceedsBalance> => {
  const due = outstanding(invoice);
  const offered = Money.fromCents(payment.amountCents);

  return Money.greaterThan(offered, due)
    ? Either.left(new PaymentExceedsBalance({ outstanding: due, offered }))
    : Either.right({
        ...invoice,
        payments: [...invoice.payments, payment],
      });
};

/** Whole days an invoice is past due, or 0 if it is not. */
export const daysOverdue = (invoice: Invoice, asAt: Date): number => {
  if (status(invoice, asAt) !== "Overdue") return 0;
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((asAt.getTime() - invoice.dueOn.getTime()) / msPerDay);
};
