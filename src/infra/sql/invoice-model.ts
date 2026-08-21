import { Model } from "@effect/sql";
import { Option, ParseResult, Schema } from "effect";
import * as Billing from "../../domain/billing/invoice";
import { CaseId, ClientId, InvoiceId } from "../../domain/shared/ids";
import { CalendarDate, Cents } from "./columns";

/**
 * The `invoices`, `invoice_lines` and `payments` tables, and the bridge to an
 * `Invoice`.
 *
 * The shape here is an aggregate: an invoice is its lines and its payments, and
 * none of the three tables means anything alone. What is *not* stored is the
 * interesting part — there is no total column and no status column, because the
 * domain derives both. A stored total is a second source of truth that
 * eventually disagrees with the lines, and "the total says 480,000 but the
 * lines add to 460,000" is not a conversation to have during a fee dispute.
 */

const InvoiceNumber = Schema.String.pipe(
  Schema.pattern(/^INV-\d{4}$/),
  Schema.annotations({ identifier: "InvoiceNumber" }),
);

/** The `invoices` row. */
export class InvoiceRow extends Model.Class<InvoiceRow>("InvoiceRow")({
  id: InvoiceId,
  number: InvoiceNumber,
  clientId: ClientId,
  caseId: Model.FieldOption(CaseId),
  issuedOn: CalendarDate,
  dueOn: CalendarDate,
  createdAt: Model.Generated(Schema.DateFromSelf),
}) {}

/**
 * A line, without its storage keys.
 *
 * As with a client's contacts: a line has a primary key in Postgres and no
 * identity in the domain. It belongs to its invoice and is never referred to
 * from anywhere else.
 */
export class InvoiceLineBody extends Model.Class<InvoiceLineBody>(
  "InvoiceLineBody",
)({
  description: Schema.NonEmptyTrimmedString,
  quantityHundredths: Schema.Int.pipe(Schema.positive()),
  unitPriceCents: Cents,
}) {}

export class PaymentBody extends Model.Class<PaymentBody>("PaymentBody")({
  amountCents: Cents,
  method: Billing.PaymentMethod,
  receivedOn: CalendarDate,
  reference: Model.FieldOption(Schema.String),
}) {}

/** The full aggregate, as three queries hand it over. */
export const InvoiceRowWithParts = Schema.Struct({
  invoice: InvoiceRow.insert,
  lines: Schema.Array(InvoiceLineBody.insert),
  payments: Schema.Array(PaymentBody.insert),
});

// ── The bridge ────────────────────────────────────────────────────────────

const toLine = (
  body: typeof InvoiceLineBody.insert.Type,
): Billing.InvoiceLine => ({
  description: body.description,
  quantityHundredths: body.quantityHundredths,
  unitPriceCents: body.unitPriceCents,
});

const toPayment = (body: typeof PaymentBody.insert.Type): Billing.Payment => {
  const reference = Option.getOrUndefined(body.reference);
  return {
    amountCents: body.amountCents,
    method: body.method,
    receivedOn: body.receivedOn,
    ...(reference === undefined ? {} : { reference }),
  };
};

export const fromPayment = (
  payment: Billing.Payment,
): typeof PaymentBody.insert.Type => ({
  amountCents: payment.amountCents,
  method: payment.method,
  receivedOn: payment.receivedOn,
  reference: Option.fromNullable(payment.reference),
});

/**
 * A payment as a **row**, ready for `sql.insert`.
 *
 * `fromPayment` above returns the *decoded* side of `PaymentBody.insert` — a
 * `Date` for `receivedOn`, an `Option` for `reference` — which is the right
 * shape for `InvoiceFromRow`, whose own encoder finishes the job. It is the
 * wrong shape to hand to `sql.insert` directly, and two write paths were doing
 * exactly that.
 *
 * Both bugs are worth naming, because they fail differently and only one of
 * them is loud:
 *
 * 1. **`reference` is an `Option`.** `sql.insert` serialises the value it is
 *    given, so a `Some("QGH7XYZ12A")` goes to Postgres as an object and the
 *    statement fails. Loud — but only when a reference is present, which is why
 *    it survived: `settleFromTrust` writes a payment with no reference at all,
 *    so every existing test passed with `Option.none()` and the defect waited
 *    for the first payment that carried one.
 *
 * 2. **`receivedOn` is a `Date`.** `payments.received_on` is a `date` column,
 *    and `CalendarDate` exists precisely because the driver sends a `Date` as a
 *    timestamp which Postgres then truncates in *local* time. This one is
 *    silent: it stores a real date, one day out, for anybody east or west of
 *    UTC. Phase 2 wrote `CalendarDate` for this and these two paths went round
 *    it.
 *
 * Encoding through the schema fixes both at once, which is the argument for
 * having one mapping rather than a pair of hand-written functions — restated
 * here because this is what it looks like when a write path quietly opts out of
 * it.
 */
export const paymentRow: (
  payment: Billing.Payment,
) => typeof PaymentBody.insert.Encoded = (payment) =>
  Schema.encodeSync(PaymentBody.insert)(fromPayment(payment));

/**
 * Rows ↔ `Invoice`.
 *
 * One refusal on the way in, and it is the counterpart of the corporate-client
 * check: the domain types `lines` as `NonEmptyArray`, because an invoice with
 * nothing on it is not an invoice and letting one exist forces every consumer
 * downstream to decide what a zero-line total means. Postgres cannot require a
 * row in another table, so the requirement is enforced here.
 */
export const InvoiceFromRow = Schema.transformOrFail(
  InvoiceRowWithParts,
  Schema.typeSchema(Billing.Invoice),
  {
    strict: true,

    decode: ({ invoice, lines, payments }, _options, ast) => {
      const [first, ...rest] = lines.map(toLine);

      if (first === undefined) {
        return ParseResult.fail(
          new ParseResult.Type(
            ast,
            { invoice, lines, payments },
            `invoice ${invoice.number}: has no lines, so it has no total and ` +
              `is not an invoice`,
          ),
        );
      }

      const caseId = Option.getOrUndefined(invoice.caseId);

      return ParseResult.succeed({
        id: invoice.id,
        number: invoice.number,
        clientId: invoice.clientId,
        issuedOn: invoice.issuedOn,
        dueOn: invoice.dueOn,
        lines: [first, ...rest] as const,
        payments: payments.map(toPayment),
        ...(caseId === undefined ? {} : { caseId }),
      });
    },

    encode: (invoice) =>
      ParseResult.succeed({
        invoice: {
          id: invoice.id,
          number: invoice.number,
          clientId: invoice.clientId,
          caseId: Option.fromNullable(invoice.caseId),
          issuedOn: invoice.issuedOn,
          dueOn: invoice.dueOn,
        },
        lines: invoice.lines.map((line) => ({
          description: line.description,
          quantityHundredths: line.quantityHundredths,
          unitPriceCents: line.unitPriceCents,
        })),
        payments: invoice.payments.map(fromPayment),
      }),
  },
).annotations({ identifier: "InvoiceFromRow" });
