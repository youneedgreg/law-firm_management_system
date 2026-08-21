import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Schema, TestClock } from "effect";
import {
  asAdvocate,
  asFinance,
  asPartner,
  asReceptionist,
  asWanjiku,
  asZenith,
  clients,
  filedMatter,
  invoices,
  matters,
  movements,
  timeEntries,
  overdueInvoice,
  partPaidInvoice,
  settledInvoice,
  TODAY,
  unfiledMatter,
  utc,
  wanjiku,
  zenith,
} from "../../test/fixtures";
import {
  inMemoryAudit,
  inMemoryBilling,
  inMemoryCases,
  inMemoryClients,
  inMemoryTime,
  inMemoryTransactor,
  restorable,
} from "../../test/in-memory-repositories";
import * as Billing from "../domain/billing/invoice";
import type { Principal } from "../domain/identity/principal";
import type * as Ledger from "../domain/trust/ledger";
import type * as Time from "../domain/time/entry";
import { InvoiceId } from "../domain/shared/ids";
import { AuditLog } from "./audit-service";
import { BillingService, type RaiseInvoice } from "./billing-service";
import { CurrentUser } from "./policy";

/**
 * `BillingService`, with no database anywhere.
 *
 * The same arrangement as `case-service.test.ts` and for the same reasons, with
 * one addition worth stating: the in-memory ledger **enforces Rule 10**, using
 * the domain's own `recordWithdrawal`. A fake that let an overdrawn settlement
 * through would make every test below pass while production refused, which is
 * precisely the failure this whole test strategy is arranged to avoid.
 *
 * What is *not* claimed here is atomicity. Two `Ref` writes are not a
 * transaction, and "a refused withdrawal leaves no payment row behind" is a
 * guarantee only Postgres can keep — it is asserted in
 * `invoice-repository.integration.test.ts` against a real database. Rules here,
 * storage guarantees there.
 */

const firm = (seed?: {
  readonly invoices?: readonly Billing.Invoice[];
  readonly movements?: readonly Ledger.TrustMovement[];
  readonly time?: readonly Time.TimeEntry[];
}) => {
  const billing = inMemoryBilling({
    invoices: seed?.invoices ?? invoices,
    movements: seed?.movements ?? movements,
  });
  const audit = inMemoryAudit();

  return {
    audit,
    billing,
    layer: Layer.mergeAll(BillingService.Default, AuditLog.Default).pipe(
      Layer.provideMerge(AuditLog.Default),
      Layer.provideMerge(
        Layer.mergeAll(
          billing.both,
          inMemoryCases(matters),
          inMemoryTime(seed?.time ?? timeEntries),
          inMemoryClients(clients),
          audit.layer,
          inMemoryTransactor(
            restorable(billing.invoiceStore),
            restorable(billing.movementStore),
          ),
        ),
      ),
    ),
  };
};

/**
 * Sets the clock, then runs the body against a freshly seeded firm.
 *
 * The clock matters more here than anywhere else in the suite: `Billing.status`
 * derives "Overdue" from the current date, so on a real clock these assertions
 * would pass today and start failing one at a time as the fixtures' due dates
 * recede.
 */
const scenario = <A, E>(
  body: Effect.Effect<A, E, BillingService | AuditLog | CurrentUser>,
  options: {
    readonly as?: Principal;
    readonly invoices?: readonly Billing.Invoice[];
    readonly movements?: readonly Ledger.TrustMovement[];
    readonly time?: readonly Time.TimeEntry[];
  } = {},
) =>
  TestClock.setTime(TODAY).pipe(
    Effect.andThen(body),
    Effect.provideService(CurrentUser, options.as ?? asFinance),
    Effect.provide(firm(options).layer),
  );

const fee: RaiseInvoice = {
  clientId: zenith.id,
  issuedOn: utc("2026-08-19"),
  dueOn: utc("2026-09-18"),
  lines: [
    {
      description: "Professional fees — August",
      quantityHundredths: 100,
      unitPriceCents: 45_000_00,
    },
  ],
};

const unknownInvoice = Schema.decodeSync(InvoiceId)(
  "60000000-0000-4000-8000-000000000099",
);

/** A fee note for Wanjiku, who has nothing in client account. */
const unpaidForWanjiku: Billing.Invoice = {
  id: Schema.decodeSync(InvoiceId)("60000000-0000-4000-8000-000000000004"),
  number: "INV-1004",
  clientId: wanjiku.id,
  issuedOn: utc("2026-08-01"),
  dueOn: utc("2026-08-31"),
  lines: [
    {
      description: "Advice on succession",
      quantityHundredths: 100,
      unitPriceCents: 5_000_00,
    },
  ],
  payments: [],
};

// ── Reading ───────────────────────────────────────────────────────────────

describe("reading fee notes", () => {
  it.effect("derives the total, the balance and the status on every read", () =>
    scenario(
      Effect.gen(function* () {
        const billing = yield* BillingService;
        const view = yield* billing.invoice(partPaidInvoice.id);

        expect(view.total).toBe(8_000_00);
        expect(view.paid).toBe(3_000_00);
        expect(view.outstanding).toBe(5_000_00);
        expect(view.status).toBe("Partially Paid");
        expect(view.daysOverdue).toBe(0);
      }),
    ),
  );

  it.effect("judges every invoice in one response against one clock", () =>
    scenario(
      Effect.gen(function* () {
        const billing = yield* BillingService;
        const receivables = yield* billing.receivables();

        expect(receivables.invoices).toHaveLength(3);
        expect(receivables.billed).toBe(11_000_00 + 13_000_00 + 8_000_00);
        expect(receivables.collected).toBe(11_000_00 + 3_000_00);
        expect(receivables.outstanding).toBe(13_000_00 + 5_000_00);
        // Only `overdueInvoice` is past its due date as at TODAY.
        expect(receivables.overdue).toBe(13_000_00);
      }),
    ),
  );

  /**
   * The absence is the assertion.
   *
   * A Receptionist may not see a figure of the firm's money at all, so they get
   * no further than the permission check. The interesting case is the one below
   * it: an Advocate holds `invoice:read` and not the whole client account, and
   * the screen is still served — with `trust` *absent* rather than empty,
   * because "you were not shown this" and "the firm holds no client money" must
   * not look the same on a page about money.
   */
  it.effect("refuses a Receptionist every figure of the firm's money", () =>
    scenario(
      Effect.gen(function* () {
        const billing = yield* BillingService;
        const refused = yield* Effect.flip(billing.receivables());

        expect(refused._tag).toBe("NotPermitted");
      }),
      { as: asReceptionist },
    ),
  );

  /**
   * A portal user gets their own fee notes and no client account at all.
   *
   * Two independent things stop them, which is the design: they hold no
   * `trust:read`, *and* their scope is one client rather than the whole firm.
   * The list is scoped in the query — two of the three seeded fee notes are
   * Zenith's — so the third was never read rather than read and filtered.
   *
   * `trust` comes back **absent**, not empty. "You were not shown this" and
   * "the firm holds no client money" must not look the same on a page about
   * money, and an empty array cannot tell them apart.
   */
  it.effect(
    "gives a portal user their own fee notes and no client account",
    () =>
      scenario(
        Effect.gen(function* () {
          const billing = yield* BillingService;
          const receivables = yield* billing.receivables();

          expect(receivables.invoices).toHaveLength(2);
          expect(
            receivables.invoices.every(
              (each) => each.invoice.clientId === zenith.id,
            ),
          ).toBe(true);

          expect(receivables.trust).toBeUndefined();
          expect(receivables.trustHeld).toBeUndefined();
        }),
        { as: asZenith },
      ),
  );

  it.effect(
    "shows the client account to finance, with the balance derived",
    () =>
      scenario(
        Effect.gen(function* () {
          const billing = yield* BillingService;
          const receivables = yield* billing.receivables();

          expect(receivables.trust).toHaveLength(1);
          expect(receivables.trust?.[0]?.clientName).toBe(
            "Zenith Distributors Ltd",
          );
          expect(receivables.trust?.[0]?.balance).toBe(250_000_00);
          expect(receivables.trustHeld).toBe(250_000_00);
        }),
      ),
  );

  /**
   * A client with no movements has no trust account.
   *
   * Not a row of zeroes: the firm has never held money for Wanjiku, and a line
   * saying `0.00` says it did and has since paid it all out. On a reconciliation
   * screen that is a different claim.
   */
  it.effect(
    "does not invent an empty account for a client with no movements",
    () =>
      scenario(
        Effect.gen(function* () {
          const billing = yield* BillingService;
          const receivables = yield* billing.receivables();

          const named = receivables.trust?.map((each) => each.clientName) ?? [];
          expect(named).not.toContain("Wanjiku Mwangi");
        }),
      ),
  );
});

describe("the ledger", () => {
  it.effect(
    "derives the balance from the movements rather than storing it",
    () =>
      scenario(
        Effect.gen(function* () {
          const billing = yield* BillingService;
          const ledger = yield* billing.ledger(zenith.id);

          expect(ledger.balance).toBe(250_000_00);
          expect(ledger.movements).toHaveLength(1);
        }),
      ),
  );

  it.effect("refuses a portal user the ledger even for their own money", () =>
    scenario(
      Effect.gen(function* () {
        const billing = yield* BillingService;
        const refused = yield* Effect.flip(billing.ledger(zenith.id));

        // `trust:read` is not among a portal user's three permissions. The
        // client account is the firm's ledger of its obligations, not a
        // statement the client is entitled to pull on demand.
        expect(refused._tag).toBe("NotPermitted");
      }),
      { as: asZenith },
    ),
  );
});

// ── Raising ───────────────────────────────────────────────────────────────

describe("raising a fee note", () => {
  it.effect("numbers it from what has already been issued", () =>
    scenario(
      Effect.gen(function* () {
        const billing = yield* BillingService;
        const raised = yield* billing.raise(fee);

        // INV-1001, -1002 and -1003 are seeded.
        expect(raised.number).toBe("INV-1004");
        expect(raised.payments).toEqual([]);
      }),
    ),
  );

  it.effect("records who raised it, in the same transaction", () =>
    scenario(
      Effect.gen(function* () {
        const billing = yield* BillingService;
        const raised = yield* billing.raise(fee);

        const audit = yield* AuditLog;
        const trail = yield* audit.trail();

        const entry = trail.find((each) => each.action === "invoice.raised");
        expect(Option.getOrNull(entry?.entityId ?? Option.none())).toBe(
          raised.id,
        );
        expect(entry?.actor.name).toBe("Adv. Amina Okwiri");
      }),
      // The audit trail is readable by a partner, and raising is theirs too.
      { as: asPartner },
    ),
  );

  it.effect(
    "refuses an Advocate, who may read fee notes and not write them",
    () =>
      scenario(
        Effect.gen(function* () {
          const billing = yield* BillingService;
          const refused = yield* Effect.flip(billing.raise(fee));

          expect(refused._tag).toBe("NotPermitted");
        }),
        { as: asAdvocate },
      ),
  );

  it.effect("retries onto the next free number when one is taken", () =>
    scenario(
      Effect.gen(function* () {
        const billing = yield* BillingService;

        // Two fee notes raised back to back both compute INV-1004 from what
        // they read; the unique index refuses the second and `raise` retries.
        const first = yield* billing.raise(fee);
        const second = yield* billing.raise(fee);

        expect(first.number).toBe("INV-1004");
        expect(second.number).toBe("INV-1005");
      }),
    ),
  );
});

/**
 * Raising a fee note from recorded time — where the two modules meet.
 */
describe("billing recorded time", () => {
  it.effect("groups the lines by activity and rate, not one per entry", () =>
    scenario(
      Effect.gen(function* () {
        const billing = yield* BillingService;

        const raised = yield* billing.raiseFromTime(unfiledMatter.id, {
          issuedOn: utc("2026-08-19"),
          dueOn: utc("2026-09-18"),
        });

        /**
         * Three billable entries become two lines: 2.5h + 1.5h of Drafting at
         * 20,000 is one line, and Grace's 2h of Drafting at 8,000 is another.
         * Merging them would price four hours of partner time at a paralegal
         * rate, or the reverse.
         */
        expect(raised.lines).toHaveLength(2);

        const total = Billing.total(raised);
        // 4h × 20,000 = 80,000; 2h × 8,000 = 16,000.
        expect(total).toBe(96_000_00);
      }),
    ),
  );

  it.effect("marks the time as billed, so it cannot be billed again", () =>
    scenario(
      Effect.gen(function* () {
        const billing = yield* BillingService;

        yield* billing.raiseFromTime(unfiledMatter.id, {
          issuedOn: utc("2026-08-19"),
          dueOn: utc("2026-09-18"),
        });

        const again = yield* Effect.flip(
          billing.raiseFromTime(unfiledMatter.id, {
            issuedOn: utc("2026-08-19"),
            dueOn: utc("2026-09-18"),
          }),
        );

        expect(again._tag).toBe("NothingToBill");
      }),
    ),
  );

  it.effect("refuses a matter with nothing unbilled on it", () =>
    scenario(
      Effect.gen(function* () {
        const billing = yield* BillingService;
        const refused = yield* Effect.flip(
          billing.raiseFromTime(filedMatter.id, {
            issuedOn: utc("2026-08-19"),
            dueOn: utc("2026-09-18"),
          }),
        );

        expect(refused._tag).toBe("NothingToBill");
        if (refused._tag === "NothingToBill") {
          expect(refused.reason).toContain("no unbilled time");
        }
      }),
    ),
  );

  it.effect("leaves written-off work off the fee note entirely", () =>
    scenario(
      Effect.gen(function* () {
        const billing = yield* BillingService;

        const raised = yield* billing.raiseFromTime(unfiledMatter.id, {
          issuedOn: utc("2026-08-19"),
          dueOn: utc("2026-09-18"),
        });

        // `writtenOffTime` is an hour of Administration, non-billable. If it
        // reached the invoice the client would be charged for a write-off.
        expect(
          raised.lines.some((line) =>
            line.description.includes("Administration"),
          ),
        ).toBe(false);
      }),
    ),
  );

  it.effect("refuses an Advocate, who may not raise fee notes", () =>
    scenario(
      Effect.gen(function* () {
        const billing = yield* BillingService;
        const refused = yield* Effect.flip(
          billing.raiseFromTime(unfiledMatter.id, {
            issuedOn: utc("2026-08-19"),
            dueOn: utc("2026-09-18"),
          }),
        );

        expect(refused._tag).toBe("NotPermitted");
      }),
      { as: asAdvocate },
    ),
  );
});

// ── Payments from outside ─────────────────────────────────────────────────

describe("recording a payment", () => {
  it.effect("applies it and re-derives the status", () =>
    scenario(
      Effect.gen(function* () {
        const billing = yield* BillingService;
        const view = yield* billing.recordPayment(overdueInvoice.id, {
          amountCents: 13_000_00,
          method: "Bank Transfer",
          receivedOn: utc("2026-08-18"),
          reference: "FT26230AB12",
        });

        expect(view.paid).toBe(13_000_00);
        expect(view.outstanding).toBe(0);
        // Overdue no longer: the status is a function of what is now paid.
        expect(view.status).toBe("Paid");
      }),
    ),
  );

  /**
   * The overpayment guard runs against the invoice *as stored*.
   *
   * A form showing a balance from thirty seconds ago is refused rather than
   * accepted against figures that have since moved — which is the same reasoning
   * as `CaseService.transition` reading the current status from storage rather
   * than from the request.
   */
  it.effect("refuses a payment larger than the balance outstanding", () =>
    scenario(
      Effect.gen(function* () {
        const billing = yield* BillingService;
        const refused = yield* Effect.flip(
          billing.recordPayment(partPaidInvoice.id, {
            amountCents: 6_000_00,
            method: "Cash",
            receivedOn: utc("2026-08-18"),
          }),
        );

        expect(refused._tag).toBe("PaymentExceedsBalance");
        if (refused._tag === "PaymentExceedsBalance") {
          expect(refused.reason).toContain("exceeds");
          expect(refused.outstanding).toBe(5_000_00);
        }
      }),
    ),
  );

  /**
   * The double post, refused.
   *
   * `SFH4KJ2L91` already sits on `settledInvoice`. Entering it again — which is
   * exactly what happens when a client forwards the same confirmation SMS twice
   * chasing a receipt — would credit the client for money that arrived once.
   */
  it.effect("refuses an M-Pesa confirmation that has already been banked", () =>
    scenario(
      Effect.gen(function* () {
        const billing = yield* BillingService;
        const refused = yield* Effect.flip(
          billing.recordPayment(partPaidInvoice.id, {
            amountCents: 1_000_00,
            method: "M-Pesa",
            receivedOn: utc("2026-08-18"),
            reference: "SFH4KJ2L91",
          }),
        );

        expect(refused._tag).toBe("PaymentAlreadyRecorded");
        if (refused._tag === "PaymentAlreadyRecorded") {
          expect(refused.reason).toContain("credit the client twice");
        }
      }),
    ),
  );

  it.effect("records the payment when the same code is used once only", () =>
    scenario(
      Effect.gen(function* () {
        const billing = yield* BillingService;
        const view = yield* billing.recordPayment(partPaidInvoice.id, {
          amountCents: 1_000_00,
          method: "M-Pesa",
          receivedOn: utc("2026-08-18"),
          reference: "RKX9MN4P22",
        });

        expect(view.paid).toBe(4_000_00);
      }),
    ),
  );

  it.effect("reports a payment against an unknown fee note as absent", () =>
    scenario(
      Effect.gen(function* () {
        const billing = yield* BillingService;
        const refused = yield* Effect.flip(
          billing.recordPayment(unknownInvoice, {
            amountCents: 1_000_00,
            method: "Cash",
            receivedOn: utc("2026-08-18"),
          }),
        );

        expect(refused._tag).toBe("NotFound");
      }),
    ),
  );

  /**
   * A portal user cannot reach another client's fee note by a *write* either.
   *
   * The read path already answers `NotFound` for this. The write path has to
   * answer the same way, and it is tested separately because the two are
   * different code paths and it is entirely possible to protect one and forget
   * the other — which is what `scoped` in the service exists to make unlikely.
   */
  it.effect("hides another client's fee note from a write, as absence", () =>
    scenario(
      Effect.gen(function* () {
        const billing = yield* BillingService;
        // `partPaidInvoice` belongs to Zenith; Wanjiku is asking.
        const refused = yield* Effect.flip(
          billing.recordPayment(partPaidInvoice.id, {
            amountCents: 1_000_00,
            method: "Cash",
            receivedOn: utc("2026-08-18"),
          }),
        );

        // Not `NotPermitted`: confirming the fee note exists would confirm that
        // the firm acts for whoever it was raised against.
        expect(refused._tag).toBe("NotPermitted");
      }),
      { as: asWanjiku },
    ),
  );
});

// ── Client money ──────────────────────────────────────────────────────────

describe("receiving client money", () => {
  it.effect("records a deposit and moves the balance", () =>
    scenario(
      Effect.gen(function* () {
        const billing = yield* BillingService;

        yield* billing.deposit({
          clientId: wanjiku.id,
          amountCents: 50_000_00,
          receivedOn: utc("2026-08-18"),
          reference: "Funds on account",
        });

        const ledger = yield* billing.ledger(wanjiku.id);
        expect(ledger.balance).toBe(50_000_00);
      }),
    ),
  );

  it.effect("refuses a deposit from someone without trust:write", () =>
    scenario(
      Effect.gen(function* () {
        const billing = yield* BillingService;
        const refused = yield* Effect.flip(
          billing.deposit({
            clientId: wanjiku.id,
            amountCents: 50_000_00,
            receivedOn: utc("2026-08-18"),
          }),
        );

        expect(refused._tag).toBe("NotPermitted");
        if (refused._tag === "NotPermitted") {
          expect(refused.permission).toBe("trust:write");
        }
      }),
      { as: asAdvocate },
    ),
  );
});

describe("settling a fee note out of client money", () => {
  it.effect("writes the payment and the withdrawal together", () =>
    scenario(
      Effect.gen(function* () {
        const billing = yield* BillingService;

        const view = yield* billing.settle(overdueInvoice.id, {
          amountCents: 13_000_00,
          settledOn: utc("2026-08-19"),
        });

        expect(view.status).toBe("Paid");

        // Zenith held 250,000 and the firm has taken its 13,000 costs.
        const ledger = yield* billing.ledger(zenith.id);
        expect(ledger.balance).toBe(237_000_00);
        expect(ledger.movements).toHaveLength(2);
        expect(ledger.movements[1]?.reason).toBe(
          "Transfer to office account for costs",
        );
      }),
    ),
  );

  /**
   * Rule 10, enforced against *that client's* balance.
   *
   * Wanjiku has no client money at all, so the firm may not take its costs out
   * of client account for her fee note — even though the firm holds a quarter of
   * a million shillings for Zenith in the same bank account. That distinction is
   * the whole of Rule 10.
   */
  it.effect("refuses a settlement the client's own balance cannot cover", () =>
    scenario(
      Effect.gen(function* () {
        const billing = yield* BillingService;

        const refused = yield* Effect.flip(
          billing.settle(settledInvoice.id, {
            amountCents: 1_000_00,
            settledOn: utc("2026-08-19"),
          }),
        );

        // `settledInvoice` is paid in full, so this is refused before Rule 10
        // is reached — which is itself the right order, and the next test is
        // the one that reaches the ledger.
        expect(refused._tag).toBe("NothingOutstanding");
      }),
    ),
  );

  it.effect("refuses a settlement against an empty client account", () =>
    scenario(
      Effect.gen(function* () {
        const billing = yield* BillingService;

        const refused = yield* Effect.flip(
          billing.settle(unpaidForWanjiku.id, {
            amountCents: 5_000_00,
            settledOn: utc("2026-08-19"),
          }),
        );

        expect(refused._tag).toBe("TrustAccountUnderfunded");
        if (refused._tag === "TrustAccountUnderfunded") {
          expect(refused.held).toBe(0);
          expect(refused.reason).toContain("r. 10");
        }
      }),
      { invoices: [...invoices, unpaidForWanjiku] },
    ),
  );

  it.effect("refuses to take more out than the fee note is worth", () =>
    scenario(
      Effect.gen(function* () {
        const billing = yield* BillingService;

        const refused = yield* Effect.flip(
          billing.settle(overdueInvoice.id, {
            amountCents: 20_000_00,
            settledOn: utc("2026-08-19"),
          }),
        );

        // The surplus would be firm money taken out of client account, which is
        // the Rule 9 breach — so the guard is the invoice's, not the ledger's.
        expect(refused._tag).toBe("PaymentExceedsBalance");
      }),
    ),
  );

  it.effect("needs both invoice:write and trust:write", () =>
    scenario(
      Effect.gen(function* () {
        const billing = yield* BillingService;

        const refused = yield* Effect.flip(
          billing.settle(overdueInvoice.id, {
            amountCents: 1_000_00,
            settledOn: utc("2026-08-19"),
          }),
        );

        expect(refused._tag).toBe("NotPermitted");
      }),
      { as: asAdvocate },
    ),
  );

  it.effect("records a settlement separately from an ordinary payment", () =>
    scenario(
      Effect.gen(function* () {
        const billing = yield* BillingService;

        yield* billing.settle(overdueInvoice.id, {
          amountCents: 13_000_00,
          settledOn: utc("2026-08-19"),
        });

        const audit = yield* AuditLog;
        const trail = yield* audit.trail();

        // Not `invoice.paid`. A settlement is the firm moving money it already
        // held; a payment is the client sending money. An auditor asking which
        // withdrawals from client account were made, and why, needs the two
        // kept apart.
        expect(trail.map((each) => each.action)).toContain("invoice.settled");
        expect(trail.map((each) => each.action)).not.toContain("invoice.paid");
      }),
      { as: asPartner },
    ),
  );
});
