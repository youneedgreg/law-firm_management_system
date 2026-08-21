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

/**
 * A Safaricom M-Pesa confirmation code.
 *
 * Ten characters, letters and digits, upper case — `QGH7XYZ12A`. Safaricom
 * sends one with every transaction and it is the only identifier both the firm
 * and the client hold, which makes it the thing a bank statement is reconciled
 * against.
 *
 * Branded rather than left as a string because of what the next section does
 * with it: this value is *unique per transaction*, and the system relies on
 * that to refuse a double post. A field that anything string-shaped could be
 * assigned to is a field somebody eventually assigns an invoice number to.
 */
export const MpesaConfirmation = Schema.String.pipe(
  Schema.pattern(/^[A-Z0-9]{10}$/),
  Schema.brand("MpesaConfirmation"),
).annotations({
  identifier: "MpesaConfirmation",
  description: "A Safaricom M-Pesa confirmation code, e.g. QGH7XYZ12A",
});

export type MpesaConfirmation = typeof MpesaConfirmation.Type;

/**
 * The fields of a payment, exported so that the wire schema can restate the
 * dates without restating anything else. See `api/wire.ts`.
 */
export const PaymentFields = {
  amountCents: Schema.Int.pipe(Schema.positive()),
  method: PaymentMethod,
  receivedOn: Schema.DateFromSelf,
  /** M-Pesa code, cheque number, bank reference — whatever reconciles it. */
  reference: Schema.optional(Schema.String),
};

/**
 * Whether a payment can be traced back to the transaction that made it.
 *
 * The rule is about M-Pesa specifically, and it is not bureaucracy. Cash has a
 * receipt book, a cheque has a number on the cheque, a bank transfer appears on
 * a statement with the payer's name on it — each is identifiable from something
 * outside this system. An M-Pesa payment is identifiable from its confirmation
 * code and from nothing else: the money arrives in a till number with a
 * telephone number beside it, and by the end of the month there are two hundred
 * of them. A recorded M-Pesa payment with no code is a payment that cannot be
 * matched to the statement, which means at the end of the quarter the firm's
 * books and Safaricom's disagree and nobody can say which is wrong.
 *
 * Exported as a predicate rather than inlined into the schema below, because
 * the wire schema in `api/wire.ts` has to enforce the identical rule and a
 * second copy of it is a second thing to keep true.
 */
export const isReconcilable = (payment: {
  readonly method: PaymentMethod;
  readonly reference?: string | undefined;
}): boolean =>
  payment.method !== "M-Pesa" ||
  (payment.reference !== undefined &&
    Schema.is(MpesaConfirmation)(payment.reference));

export const RECONCILABLE_MESSAGE =
  "An M-Pesa payment must carry its confirmation code (ten characters, " +
  "e.g. QGH7XYZ12A). It is the only thing the M-Pesa statement can be " +
  "reconciled against";

export const Payment = Schema.Struct(PaymentFields).pipe(
  Schema.filter((payment) =>
    isReconcilable(payment) ? undefined : RECONCILABLE_MESSAGE,
  ),
);

export type Payment = typeof Payment.Type;

/** The confirmation code on a payment, where it has one. */
export const confirmationOf = (
  payment: Payment,
): MpesaConfirmation | undefined =>
  payment.method === "M-Pesa" && payment.reference !== undefined
    ? (payment.reference as MpesaConfirmation)
    : undefined;

/**
 * This confirmation code has already been banked.
 *
 * The failure it prevents is the double post, which is the single most common
 * way a client is credited twice: the confirmation SMS is forwarded to the
 * firm, somebody enters it, the client forwards it again a week later chasing a
 * receipt, and somebody enters it again. Both entries look completely
 * legitimate on their own.
 *
 * Uniqueness is enforced by a partial unique index in Postgres and translated
 * back to this error by the repository, exactly as the Rule 10 trigger becomes
 * `TrustAccountUnderfunded`. The database is the arbiter because the check and
 * the write have to be atomic; recognising the refusal is the repository's job.
 */
export class PaymentAlreadyRecorded extends Schema.TaggedError<PaymentAlreadyRecorded>()(
  "PaymentAlreadyRecorded",
  { confirmation: Schema.String },
) {
  get reason(): string {
    return (
      `M-Pesa confirmation ${this.confirmation} has already been recorded ` +
      `against a fee note. Entering it again would credit the client twice — ` +
      `check the statement before overriding`
    );
  }
}

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
