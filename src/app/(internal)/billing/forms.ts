import { Either, Schema } from "effect";
import * as Billing from "@/domain/billing/invoice";
import { CaseId, ClientId } from "@/domain/shared/ids";
import * as Money from "@/domain/shared/money";
import type {
  RaiseInvoice,
  RecordDeposit,
  ReceivePayment,
  SettleFromTrust,
} from "@/services/billing-service";

/**
 * The boundary between a browser form and the money.
 *
 * The same arrangement as `cases/forms.ts`, and for the same reason — a
 * `<form>` submits strings, and `Number("12,000")` is `NaN` — but the stakes
 * are different enough to restate. A mistyped claim value produces a matter
 * with an odd figure on it. A mistyped payment produces a client credited for
 * money that never arrived, and the mistake is discovered at the year end by an
 * accountant rather than at the keyboard by the person who made it.
 *
 * So every amount goes through `Money.fromShillings`, which **refuses** rather
 * than rounds: `1200.005` is not 1,200.01, it is a typo, and the form says so
 * with the field named. Nothing here decides whether a payment is *allowed* —
 * Rule 10, the overpayment guard and the duplicate confirmation all belong to
 * the domain and the service, and a form that re-checked them would be the copy
 * that goes stale.
 */

/**
 * A submission as a plain record, with blank fields removed.
 *
 * Identical to the cases module's, and deliberately duplicated rather than
 * hoisted: it is six lines, it belongs to the boundary it serves, and a shared
 * `lib/forms/submitted` would be a thing two route groups have to agree about
 * forever to save nothing.
 */
export const submitted = (form: FormData): Record<string, string> => {
  const fields: Record<string, string> = {};
  for (const [name, value] of form.entries()) {
    if (typeof value === "string" && value.trim() !== "") {
      fields[name] = value;
    }
  }
  return fields;
};

/**
 * Shillings in, cents stored — refusing anything finer than a cent.
 *
 * `Money` is an integer number of cents throughout the system, and this is one
 * of the two places the conversion happens. A float that cannot be represented
 * exactly is a `FractionalCents` failure with the field's name on it, not a
 * silent `Math.round`.
 */
const Shillings = Schema.transformOrFail(
  Schema.NumberFromString,
  Schema.Int.pipe(Schema.nonNegative()),
  {
    strict: true,
    decode: (shillings, _options, ast) =>
      Either.mapLeft(Money.fromShillings(shillings), () => ({
        _tag: "Type" as const,
        ast,
        actual: shillings,
        message: `${shillings} is not a whole number of cents`,
      })),
    encode: (cents) => Either.right(cents / 100),
  },
).annotations({
  identifier: "Shillings",
  description: "An amount typed in shillings, stored as whole cents",
});

/** Positive amounts only: a payment of nothing is not a payment. */
const PositiveShillings = Shillings.pipe(Schema.positive());

/** A date input submits `YYYY-MM-DD`; the domain wants a `Date` at UTC midnight. */
const DayInput = Schema.transform(
  Schema.String.pipe(Schema.pattern(/^\d{4}-\d{2}-\d{2}$/)),
  Schema.DateFromSelf,
  {
    strict: true,
    decode: (day) => new Date(`${day}T00:00:00.000Z`),
    encode: (date) => date.toISOString().slice(0, 10),
  },
).annotations({ identifier: "DayInput" });

/**
 * Raising a fee note, from a form with one line on it.
 *
 * One line rather than a repeating fieldset, and it is a real limitation rather
 * than an oversight: an invoice with several lines is normally built from
 * recorded time, which is the *next* slice, and a dynamic line editor built now
 * would be thrown away when it is. The domain accepts many lines and the API
 * accepts many lines; this form offers one, and says so.
 *
 * `quantity` is in hundredths on the domain side — 2.5 hours is `250` — because
 * a float quantity multiplied by a cent amount reintroduces exactly the
 * rounding error `Money` exists to keep out.
 */
export const RaiseInvoiceForm = Schema.transform(
  Schema.Struct({
    clientId: ClientId,
    caseId: Schema.optional(CaseId),
    issuedOn: DayInput,
    dueOn: DayInput,
    description: Schema.NonEmptyTrimmedString,
    quantity: Schema.NumberFromString.pipe(Schema.positive()),
    unitPrice: PositiveShillings,
  }),
  Schema.typeSchema(
    Schema.Struct({
      clientId: ClientId,
      caseId: Schema.optional(CaseId),
      issuedOn: Schema.DateFromSelf,
      dueOn: Schema.DateFromSelf,
      lines: Schema.NonEmptyArray(Billing.InvoiceLine),
    }),
  ),
  {
    strict: true,
    decode: (form) => ({
      clientId: form.clientId,
      ...(form.caseId === undefined ? {} : { caseId: form.caseId }),
      issuedOn: form.issuedOn,
      dueOn: form.dueOn,
      lines: [
        {
          description: form.description,
          quantityHundredths: Math.round(form.quantity * 100),
          unitPriceCents: form.unitPrice,
        },
      ] as const,
    }),
    encode: () => {
      throw new Error("RaiseInvoiceForm is decode-only");
    },
  },
);

/**
 * A payment received from outside.
 *
 * The M-Pesa rule arrives here from the domain rather than being restated: the
 * struct-level filter is `Billing.isReconcilable`, the same predicate the
 * domain schema and the wire schema both apply. A user who chooses M-Pesa and
 * leaves the reference blank is told at the form, not after a round trip.
 */
export const ReceivePaymentForm = Schema.Struct({
  amount: PositiveShillings,
  method: Billing.PaymentMethod,
  receivedOn: DayInput,
  reference: Schema.optional(Schema.NonEmptyTrimmedString),
}).pipe(
  Schema.filter((form) =>
    Billing.isReconcilable({
      method: form.method,
      reference: form.reference,
    })
      ? undefined
      : { path: ["reference"], message: Billing.RECONCILABLE_MESSAGE },
  ),
);

export const SettleFromTrustForm = Schema.Struct({
  amount: PositiveShillings,
  settledOn: DayInput,
});

export const RecordDepositForm = Schema.Struct({
  clientId: ClientId,
  amount: PositiveShillings,
  receivedOn: DayInput,
  reference: Schema.optional(Schema.NonEmptyTrimmedString),
});

/**
 * The four form shapes, mapped onto what the service accepts.
 *
 * Written out rather than inferred, because the field names differ on purpose:
 * a form says "Amount (KES)" and the service takes `amountCents`, and hiding
 * that behind a shared name would hide the unit — which is the one thing about
 * money that must never be ambiguous.
 */
export const asPayment = (
  form: typeof ReceivePaymentForm.Type,
): ReceivePayment => ({
  amountCents: form.amount,
  method: form.method,
  receivedOn: form.receivedOn,
  ...(form.reference === undefined ? {} : { reference: form.reference }),
});

export const asSettlement = (
  form: typeof SettleFromTrustForm.Type,
): SettleFromTrust => ({
  amountCents: form.amount,
  settledOn: form.settledOn,
});

export const asDeposit = (
  form: typeof RecordDepositForm.Type,
): RecordDeposit => ({
  clientId: form.clientId,
  amountCents: form.amount,
  receivedOn: form.receivedOn,
  ...(form.reference === undefined ? {} : { reference: form.reference }),
});

export const asInvoice = (form: typeof RaiseInvoiceForm.Type): RaiseInvoice =>
  form;
