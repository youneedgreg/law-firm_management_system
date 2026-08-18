import { Either, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { ClientId, InvoiceId } from "../shared/ids";
import * as Money from "../shared/money";
import * as Billing from "./invoice";

const invoiceId = Schema.decodeSync(InvoiceId)(
  "30000000-0000-4000-8000-000000000001",
);
const clientId = Schema.decodeSync(ClientId)(
  "00000000-0000-4000-8000-000000000001",
);

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

const invoice = (
  lines: readonly Billing.InvoiceLine[],
  payments: readonly Billing.Payment[] = [],
): Billing.Invoice => ({
  id: invoiceId,
  number: "INV-3001",
  clientId,
  issuedOn: utc("2026-08-01"),
  dueOn: utc("2026-08-31"),
  lines: lines as unknown as Billing.Invoice["lines"],
  payments,
});

const line = (
  description: string,
  hours: number,
  rateShillings: number,
): Billing.InvoiceLine => ({
  description,
  quantityHundredths: Math.round(hours * 100),
  unitPriceCents: rateShillings * 100,
});

const payment = (shillings: number, on = "2026-08-15"): Billing.Payment => ({
  amountCents: shillings * 100,
  method: "M-Pesa",
  receivedOn: utc(on),
});

describe("totals are derived from the lines", () => {
  it("sums line amounts", () => {
    const subject = invoice([
      line("Drafting the plaint", 2.5, 20_000),
      line("Court attendance", 1, 30_000),
    ]);

    // 2.5 × 20,000 = 50,000, plus 30,000
    expect(Billing.total(subject)).toBe(Money.fromCents(80_000_00));
  });

  it("handles fractional hours without losing cents", () => {
    const subject = invoice([line("Research", 0.25, 15_000)]);
    expect(Billing.total(subject)).toBe(Money.fromCents(3_750_00));
  });

  it("rounds a third of an hour to the cent", () => {
    // 0.33 h × 10,000 = 3,300 exactly at hundredths precision.
    const subject = invoice([line("Call with client", 0.33, 10_000)]);
    expect(Billing.total(subject)).toBe(Money.fromCents(3_300_00));
  });
});

describe("status is a function of payments and the date", () => {
  const subject = invoice([line("Drafting", 1, 100_000)]);

  it("is unpaid before anything is received", () => {
    expect(Billing.status(subject, utc("2026-08-10"))).toBe("Unpaid");
  });

  it("is partially paid after something is received", () => {
    const part = invoice(subject.lines, [payment(40_000)]);
    expect(Billing.status(part, utc("2026-08-20"))).toBe("Partially Paid");
    expect(Billing.outstanding(part)).toBe(Money.fromCents(60_000_00));
  });

  it("is paid once the balance reaches zero", () => {
    const settled = invoice(subject.lines, [payment(60_000), payment(40_000)]);
    expect(Billing.status(settled, utc("2026-09-30"))).toBe("Paid");
  });

  it("stays paid after the due date — settled is settled", () => {
    const settled = invoice(subject.lines, [payment(100_000)]);
    expect(Billing.status(settled, utc("2027-01-01"))).toBe("Paid");
  });

  it("becomes overdue only once the due date has passed", () => {
    expect(Billing.status(subject, utc("2026-08-31"))).toBe("Unpaid");
    expect(Billing.status(subject, utc("2026-09-01"))).toBe("Overdue");
  });

  it("reports a partially paid invoice past its date as overdue", () => {
    const part = invoice(subject.lines, [payment(10_000)]);
    expect(Billing.status(part, utc("2026-09-15"))).toBe("Overdue");
  });

  it("represents overpayment rather than hiding it", () => {
    const over: Billing.Invoice = {
      ...subject,
      payments: [payment(120_000)],
    };
    expect(Billing.status(over, utc("2026-08-20"))).toBe("Overpaid");
    expect(Money.isNegative(Billing.outstanding(over))).toBe(true);
  });

  it("does not depend on ambient time", () => {
    // The same invoice, two different "now"s, two different answers — and no
    // waiting involved, which is the point of asAt being a parameter.
    expect(Billing.status(subject, utc("2026-08-02"))).toBe("Unpaid");
    expect(Billing.status(subject, utc("2026-12-02"))).toBe("Overdue");
  });
});

describe("daysOverdue", () => {
  const subject = invoice([line("Drafting", 1, 100_000)]);

  it("counts days past the due date", () => {
    expect(Billing.daysOverdue(subject, utc("2026-09-10"))).toBe(10);
  });

  it("is zero while the invoice is not overdue", () => {
    expect(Billing.daysOverdue(subject, utc("2026-08-15"))).toBe(0);
  });

  it("is zero for a settled invoice, however late the date", () => {
    const settled = invoice(subject.lines, [payment(100_000)]);
    expect(Billing.daysOverdue(settled, utc("2027-06-01"))).toBe(0);
  });
});

describe("recordPayment", () => {
  const subject = invoice([line("Drafting", 1, 100_000)]);

  it("applies a payment within the balance", () => {
    const result = Billing.recordPayment(subject, payment(40_000));
    const updated = Either.getOrThrow(result);

    expect(updated.payments).toHaveLength(1);
    expect(Billing.outstanding(updated)).toBe(Money.fromCents(60_000_00));
  });

  it("accepts a payment that settles the invoice exactly", () => {
    const result = Billing.recordPayment(subject, payment(100_000));
    expect(Either.isRight(result)).toBe(true);
  });

  it("refuses one that would overpay, since that is usually a typo", () => {
    const result = Billing.recordPayment(subject, payment(150_000));
    const error = Option.getOrThrow(Either.getLeft(result));

    expect(error._tag).toBe("PaymentExceedsBalance");
    expect(error.reason).toContain("exceeds");
  });

  it("leaves the invoice untouched when it refuses", () => {
    Billing.recordPayment(subject, payment(150_000));
    expect(subject.payments).toHaveLength(0);
  });
});

describe("schema constraints", () => {
  it("rejects an invoice with no lines", () => {
    const result = Schema.decodeUnknownEither(Billing.Invoice)({
      id: invoiceId,
      number: "INV-3001",
      clientId,
      issuedOn: utc("2026-08-01"),
      dueOn: utc("2026-08-31"),
      lines: [],
      payments: [],
    });

    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects a zero or negative payment", () => {
    const result = Schema.decodeUnknownEither(Billing.Payment)({
      amountCents: 0,
      method: "M-Pesa",
      receivedOn: utc("2026-08-15"),
    });

    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects a payment method the firm does not accept", () => {
    const result = Schema.decodeUnknownEither(Billing.Payment)({
      amountCents: 5000,
      method: "Barter",
      receivedOn: utc("2026-08-15"),
    });

    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects a blank line description", () => {
    const result = Schema.decodeUnknownEither(Billing.InvoiceLine)({
      description: "   ",
      quantityHundredths: 100,
      unitPriceCents: 10_000,
    });

    expect(Either.isLeft(result)).toBe(true);
  });
});
