import { Either, Schema, Struct } from "effect";
import { describe, expect, it } from "vitest";
import * as Billing from "../../domain/billing/invoice";
import { CaseId, ClientId, InvoiceId } from "../../domain/shared/ids";
import { InvoiceFromRow } from "./invoice-model";

/**
 * The rows ↔ `Invoice` bridge.
 *
 * What is being checked, mostly, is an absence: the total and the status are
 * derived by the domain and stored nowhere, so a round trip has to reproduce
 * them from the lines alone.
 */

const id = Schema.decodeSync(InvoiceId)("55555555-5555-4555-8555-555555555555");
const clientId = Schema.decodeSync(ClientId)(
  "22222222-2222-4222-8222-222222222222",
);
const caseId = Schema.decodeSync(CaseId)(
  "11111111-1111-4111-8111-111111111111",
);

const invoice: Billing.Invoice = {
  id,
  number: "INV-1042",
  clientId,
  caseId,
  issuedOn: new Date("2026-08-01T00:00:00.000Z"),
  dueOn: new Date("2026-08-31T00:00:00.000Z"),
  lines: [
    {
      description: "Drafting plaint and verifying affidavit",
      quantityHundredths: 250,
      unitPriceCents: 15_000_00,
    },
    {
      description: "Court attendance — mention",
      quantityHundredths: 100,
      unitPriceCents: 20_000_00,
    },
  ],
  payments: [
    {
      amountCents: 20_000_00,
      method: "M-Pesa",
      receivedOn: new Date("2026-08-10T00:00:00.000Z"),
      reference: "SJ42KL9PQ1",
    },
  ],
};

const encode = Schema.encodeSync(InvoiceFromRow);
const decode = Schema.decodeUnknownSync(InvoiceFromRow);
const decodeEither = Schema.decodeUnknownEither(InvoiceFromRow);

describe("an invoice survives the round trip", () => {
  it("with its lines and payments", () => {
    expect(decode(encode(invoice))).toStrictEqual(invoice);
  });

  it("with no payments against it yet", () => {
    const unpaid: Billing.Invoice = { ...invoice, payments: [] };

    expect(decode(encode(unpaid))).toStrictEqual(unpaid);
  });

  it("with no matter attached", () => {
    const general = Struct.omit(invoice, "caseId");

    expect(decode(encode(general))).toStrictEqual(general);
    expect(encode(general).invoice.caseId).toBeNull();
  });

  it("reproduces the total from the lines, having stored none", () => {
    const row = encode(invoice);

    expect(Object.keys(row.invoice)).not.toContain("totalCents");
    expect(Object.keys(row.invoice)).not.toContain("status");
    expect(Billing.total(decode(row))).toBe(Billing.total(invoice));
  });

  it("reproduces the derived status", () => {
    const asAt = new Date("2026-08-15T00:00:00.000Z");

    expect(Billing.status(decode(encode(invoice)), asAt)).toBe(
      "Partially Paid",
    );
  });

  it("keeps line order, because an invoice is a document", () => {
    const decoded = decode(encode(invoice));

    expect(decoded.lines.map((line) => line.description)).toStrictEqual(
      invoice.lines.map((line) => line.description),
    );
  });
});

describe("rows the database allows and the domain does not", () => {
  /**
   * `lines` is a `NonEmptyArray` because an invoice with nothing on it has no
   * total, and every consumer downstream would have to decide what zero means.
   * Postgres cannot require a row in another table, so it is caught here.
   */
  it("refuses an invoice with no lines", () => {
    const result = decodeEither({ ...encode(invoice), lines: [] });

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.message).toContain("no lines");
    }
  });

  it("refuses a payment of zero", () => {
    const row = encode(invoice);

    expect(
      Either.isLeft(
        decodeEither({
          ...row,
          payments: [{ ...row.payments[0], amountCents: 0 }],
        }),
      ),
    ).toBe(true);
  });

  it("refuses a money column that arrived as a float", () => {
    const row = encode(invoice);

    expect(
      Either.isLeft(
        decodeEither({
          ...row,
          lines: [{ ...row.lines[0], unitPriceCents: "1500000.5" }],
        }),
      ),
    ).toBe(true);
  });

  it("reads money columns arriving as bigint strings", () => {
    const row = encode(invoice);
    const decoded = decode({
      ...row,
      lines: [{ ...row.lines[0], unitPriceCents: "1500000" }],
    });

    expect(decoded.lines[0].unitPriceCents).toBe(15_000_00);
  });
});
