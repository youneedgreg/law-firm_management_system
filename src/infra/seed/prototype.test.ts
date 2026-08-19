import { Either } from "effect";
import { describe, expect, it } from "vitest";
import * as Billing from "../../domain/billing/invoice";
import * as Matter from "../../domain/case/case";
import * as ClientDomain from "../../domain/client/client";
import * as Advocate from "../../domain/firm/advocate";
import * as Ledger from "../../domain/trust/ledger";
import { phoneKind } from "../../domain/shared/ids";
import { CASES } from "../../lib/data/cases";
import { stableId } from "./ids";
import {
  advocates,
  clientIdsByPrototypeKey,
  clients,
  firmEmail,
  invoices,
  matters,
  parseContact,
  parsePrototypeDate,
  trustMovements,
} from "./prototype";
import { AS_AT, COURTS } from "./supplement";

/**
 * The import, without a database.
 *
 * Everything that can go wrong in a seed goes wrong here, in the translation:
 * a court name with no court behind it, a status the domain derives differently
 * from the tag the prototype stored, a date that moves a day. The script itself
 * is a loop over repositories; this is the part worth testing.
 */

const right = <A, E>(result: Either.Either<A, E>): A => {
  if (Either.isLeft(result)) {
    throw new Error(`expected success, got ${JSON.stringify(result.left)}`);
  }
  return result.right;
};

describe("derived ids", () => {
  it("gives the same uuid on every run, which is what makes the seed idempotent", () => {
    expect(stableId("client", 4)).toBe(stableId("client", 4));
  });

  /**
   * Pinned deliberately. These ids are foreign keys in a seeded database, so
   * changing the namespace renames every row — this test makes that a decision
   * rather than an accident.
   */
  it("is pinned to its namespace", () => {
    expect(stableId("client", 1)).toBe("26ab3867-0bb1-587c-8765-7915980fd0d0");
  });

  it("is a well-formed v5 uuid", () => {
    expect(stableId("case", 3)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("separates the kinds, so a client and a case never collide", () => {
    expect(stableId("client", 1)).not.toBe(stableId("case", 1));
  });
});

describe("parsing what the prototype wrote", () => {
  it("reads the one date format the fixtures use", () => {
    expect(parsePrototypeDate("14 Feb 2026")).toStrictEqual(
      new Date("2026-02-14T00:00:00.000Z"),
    );
    expect(parsePrototypeDate("3 Mar 2026")).toStrictEqual(
      new Date("2026-03-03T00:00:00.000Z"),
    );
  });

  /**
   * `Date.parse("14 Feb 2026")` succeeds on most runtimes and applies the local
   * zone, which in Nairobi lands the previous evening — and a filing date that
   * moves a day is the difference between inside and outside a limitation
   * period.
   */
  it("does not let the local zone move the day", () => {
    expect(parsePrototypeDate("1 Jan 2026")?.toISOString()).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });

  it.each(["2026-02-14", "14 February 2026", "31 Feb 2026", "", "soon"])(
    "refuses %o instead of returning an Invalid Date",
    (input) => {
      expect(parsePrototypeDate(input)).toBeUndefined();
    },
  );

  it("splits a contact into the person and the capacity they act in", () => {
    expect(parseContact("Peter Kamau (CFO)")).toStrictEqual({
      name: "Peter Kamau",
      role: "CFO",
    });
  });

  it("falls back to a stated role rather than an empty one", () => {
    expect(parseContact("Wanjiku Mwangi")).toStrictEqual({
      name: "Wanjiku Mwangi",
      role: "Primary contact",
    });
  });

  it("strips the title the prototype carries instead of a name", () => {
    expect(firmEmail("Adv. Sarah Wanjiru")).toBe("sarah.wanjiru@oklaw.co.ke");
    expect(firmEmail("Legal Assistant - Mercy")).toBe("mercy@oklaw.co.ke");
    expect(firmEmail("Finance - Peter")).toBe("peter@oklaw.co.ke");
  });
});

describe("staff", () => {
  const staff = right(advocates());

  it("decodes every fixture", () => {
    expect(staff).toHaveLength(6);
  });

  it("renames the prototype's 'Paralegal' to the role the domain has", () => {
    const roles = staff.map((person) => person.role);

    expect(roles).toContain("Legal Assistant");
    expect(roles).not.toContain("Paralegal");
  });

  /**
   * The point of the certificate field: the paralegal, the finance officer and
   * the receptionist cannot appear in court, and they cannot because they hold
   * no certificate rather than because a flag says so.
   */
  it("gives certificates only to advocates", () => {
    const certified = staff
      .filter((person) => person.practisingCertificate !== undefined)
      .map((person) => person.name);

    expect(certified).toStrictEqual([
      "Adv. Sarah Wanjiru",
      "Adv. Brian Kiptoo",
      "Adv. Faith Achieng",
    ]);
  });

  it("produces staff who may appear in court, and staff who may not", () => {
    const mercy = staff.find((p) => p.name === "Legal Assistant - Mercy");
    const sarah = staff.find((p) => p.name === "Adv. Sarah Wanjiru");

    expect(Advocate.mayAppearInCourt(sarah!, AS_AT)).toBe(true);
    expect(Advocate.mayAppearInCourt(mercy!, AS_AT)).toBe(false);
  });
});

describe("clients", () => {
  const firmClients = right(clients());

  it("decodes every fixture", () => {
    expect(firmClients).toHaveLength(6);
  });

  it("splits the union the prototype stored as a string field", () => {
    const kinds = firmClients.map((client) => client._tag);

    expect(kinds.filter((kind) => kind === "Individual")).toHaveLength(3);
    expect(kinds.filter((kind) => kind === "Corporate")).toHaveLength(3);
  });

  /**
   * `checkPin` is the domain's own cross-check, and running it here is the
   * whole reason the PINs live in a reviewable table: an `A` PIN typed against
   * a company propagates onto every invoice afterwards.
   */
  it("issues PINs that match the kind of client they belong to", () => {
    for (const client of firmClients) {
      expect(Either.isRight(ClientDomain.checkPin(client))).toBe(true);
    }
  });

  it("normalises the phone numbers the prototype wrote with spaces", () => {
    for (const client of firmClients) {
      expect(client.phone).toMatch(/^\+254[1-9]\d{8}$/);
    }
  });

  /**
   * The fixtures' corporate numbers are switchboard landlines. They were
   * substituted with mobiles while `KenyanPhone` accepted mobile ranges only —
   * the seed falsifying data to satisfy a type that was too narrow. This
   * asserts the substitution is gone and the real numbers survive.
   */
  it("keeps a company's switchboard number rather than substituting one", () => {
    const company = firmClients.find(
      (client) => client.name === "General Innovations Ltd",
    );

    expect(company?.phone).toBe("+254204453021");
    expect(phoneKind(company!.phone)).toBe("fixed line");
  });

  it("still knows which numbers can receive an SMS", () => {
    const person = firmClients.find(
      (client) => client.name === "Wanjiku Mwangi",
    );

    expect(phoneKind(person!.phone)).toBe("mobile");
  });

  it("gives every company someone who can instruct the firm", () => {
    for (const client of firmClients) {
      if (client._tag !== "Corporate") continue;
      expect(client.contacts.length).toBeGreaterThan(0);
      expect(ClientDomain.primaryContact(client)).not.toBe("");
    }
  });
});

describe("matters", () => {
  const staff = right(advocates());
  const advocateIds = new Map(staff.map((person) => [person.name, person.id]));
  const firmMatters = right(matters(clientIdsByPrototypeKey(), advocateIds));

  it("decodes every fixture", () => {
    expect(firmMatters).toHaveLength(8);
  });

  /**
   * The guard that keeps the mapping honest as fixtures change. A court name
   * with no entry is a failure at import time; this makes it a failure at test
   * time instead, which is the cheaper place to find it.
   */
  it("has a court for every court name the fixtures use", () => {
    const unmapped = [...new Set(CASES.map((each) => each.court))].filter(
      (name) => !(name in COURTS),
    );

    expect(unmapped).toStrictEqual([]);
  });

  it("turns free text into courts that know their own jurisdiction", () => {
    const civil = firmMatters.find((each) => each.number === "OKL-2026-014");

    expect(civil?.court).toStrictEqual({
      _tag: "MagistratesCourt",
      station: "Milimani",
      rank: "Chief Magistrate",
    });
  });

  /**
   * The Tax Appeals Tribunal is constituted under its own Act and is not a
   * court in the Article 162 hierarchy. `Case.court` is optional so this can be
   * recorded truthfully rather than filed under the nearest court.
   */
  it("leaves a matter before a tribunal without a court", () => {
    const tax = firmMatters.find((each) => each.number === "OKL-2026-032");

    expect(tax).toBeDefined();
    expect(tax?.court).toBeUndefined();
  });

  it("refuses a magistrates' court filing with no claim value recorded", () => {
    const criminal = firmMatters.find((each) => each.number === "OKL-2026-021");
    const court = criminal?.court;

    expect(court).toBeDefined();
    const result = Matter.canFileIn(criminal!, court!);
    expect(Either.isLeft(result)).toBe(true);
  });

  it("accepts a magistrates' court filing within the pecuniary limit", () => {
    const civil = firmMatters.find((each) => each.number === "OKL-2026-014");

    expect(Either.isRight(Matter.canFileIn(civil!, civil!.court!))).toBe(true);
  });

  it("fails loudly when a matter's client was never seeded", () => {
    const result = matters(new Map(), advocateIds);

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toHaveLength(8);
      expect(result.left[0]?.reason).toContain("no seeded client");
    }
  });

  it("fails loudly when an advocate was never seeded", () => {
    const result = matters(clientIdsByPrototypeKey(), new Map());

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left[0]?.reason).toContain("no seeded advocate");
    }
  });
});

describe("invoices", () => {
  const firmClients = right(clients());
  const staff = right(advocates());
  const clientIdsByName = new Map(
    firmClients.map((client) => [client.name, client.id as string]),
  );
  const firmMatters = right(
    matters(
      clientIdsByPrototypeKey(),
      new Map(staff.map((person) => [person.name, person.id])),
    ),
  );
  const caseIds = new Map(
    firmMatters.map((matter) => [matter.number as string, matter.id as string]),
  );
  const firmInvoices = right(invoices(clientIdsByName, caseIds));

  it("decodes every fixture", () => {
    expect(firmInvoices).toHaveLength(6);
  });

  /**
   * The prototype stores a status; the domain derives one. The adapter works
   * backwards from the tag to the payments and due date that would produce it,
   * and refuses if the two disagree — so this asserts the property the adapter
   * is built to guarantee.
   */
  it.each([
    ["INV-3001", "Paid"],
    ["INV-3002", "Partially Paid"],
    ["INV-3003", "Overdue"],
    ["INV-3004", "Paid"],
    ["INV-3005", "Partially Paid"],
    ["INV-3006", "Overdue"],
  ])("derives %s as %s, the status the prototype claimed", (number, status) => {
    const invoice = firmInvoices.find((each) => each.number === number);

    expect(invoice).toBeDefined();
    expect(Billing.status(invoice!, AS_AT)).toBe(status);
  });

  it("keeps the totals the prototype showed", () => {
    const total = firmInvoices.reduce(
      (running, invoice) => running + Billing.total(invoice),
      0,
    );

    // 120,000 + 480,000 + 95,000 + 265,000 + 340,000 + 150,000 shillings.
    expect(total).toBe(1_450_000_00);
  });

  it("leaves an overdue invoice with nothing paid against it", () => {
    const overdue = firmInvoices.find((each) => each.number === "INV-3003");

    expect(overdue?.payments).toStrictEqual([]);
    expect(Billing.outstanding(overdue!)).toBe(Billing.total(overdue!));
  });

  it("fails loudly when an invoice names a client that was never seeded", () => {
    const result = invoices(new Map(), caseIds);

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left[0]?.reason).toContain("no seeded client");
    }
  });
});

describe("the trust ledger", () => {
  const firmClients = right(clients());
  const clientIdsByName = new Map(
    firmClients.map((client) => [client.name, client.id as string]),
  );
  const movements = right(trustMovements(clientIdsByName));

  it("turns each pair of running totals into a deposit and a withdrawal", () => {
    expect(movements).toHaveLength(6);
    expect(
      movements.filter((m) => m.reason === "Deposit received"),
    ).toHaveLength(3);
  });

  /**
   * Not a detail of the import — the rule. A withdrawal recorded before its
   * deposit is refused by Rule 10 against a balance of nothing, so the order
   * these are emitted in is load-bearing.
   */
  it("records every deposit before the withdrawal it funds", () => {
    for (const withdrawal of movements.filter((m) =>
      Ledger.isWithdrawal(m.reason),
    )) {
      const deposit = movements.find(
        (m) =>
          m.clientId === withdrawal.clientId && !Ledger.isWithdrawal(m.reason),
      );

      expect(deposit).toBeDefined();
      expect(deposit!.recordedAt.getTime()).toBeLessThan(
        withdrawal.recordedAt.getTime(),
      );
    }
  });

  it("gives every withdrawal a purpose Rule 9 permits", () => {
    for (const movement of movements) {
      expect(Ledger.MOVEMENT_REASONS).toContain(movement.reason);
    }
  });

  /**
   * The roadmap's post-import gate, run against the adapted data before it ever
   * reaches Postgres. The seed script runs the same check against the database
   * afterwards; this one fails in milliseconds.
   */
  it("leaves no client overdrawn", () => {
    expect(Ledger.overdrawnClients(movements)).toStrictEqual([]);
  });

  it("holds the balance the prototype's totals imply", () => {
    expect(Ledger.totalHeld(movements)).toBe(240_000_00);
  });
});

describe("matters open before they are filed", () => {
  const staff = right(advocates());
  const firmMatters = right(
    matters(
      clientIdsByPrototypeKey(),
      new Map(staff.map((person) => [person.name, person.id])),
    ),
  );

  /**
   * `openedOn` and `filedOn` were seeded equal while the supplement had no
   * intake date, which said every matter was filed the day it walked in the
   * door. Intake, conflict screening and drafting all sit in that gap.
   */
  it("gives every matter a gap between intake and filing", () => {
    for (const matter of firmMatters) {
      expect(matter.filedOn).toBeDefined();
      expect(matter.openedOn.getTime()).toBeLessThan(matter.filedOn!.getTime());
    }
  });

  it("satisfies the filed_after_opened constraint the database enforces", () => {
    for (const matter of firmMatters) {
      expect(matter.filedOn!.getTime()).toBeGreaterThanOrEqual(
        matter.openedOn.getTime(),
      );
    }
  });
});
