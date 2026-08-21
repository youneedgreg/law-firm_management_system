import { Either, Option } from "effect";
import { describe, expect, it } from "vitest";
import * as Billing from "../../domain/billing/invoice";
import * as Matter from "../../domain/case/case";
import * as ClientDomain from "../../domain/client/client";
import * as Documents from "../../domain/document/document";
import * as Advocate from "../../domain/firm/advocate";
import * as Ledger from "../../domain/trust/ledger";
import * as Work from "../../domain/work/task";
import * as Correspondence from "../../domain/message/message";
import { phoneKind } from "../../domain/shared/ids";
import { CASES } from "../../lib/data/cases";
import { stableId } from "./ids";
import {
  advocates,
  clientIdsByPrototypeKey,
  clients,
  documents,
  firmEmail,
  invoices,
  matters,
  messages,
  parseContact,
  parsePrototypeDate,
  tasks,
  trustMovements,
} from "./prototype";
import { AS_AT, COURTS, FILED_WITH_COURT } from "./supplement";

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

describe("the document register", () => {
  const staff = right(advocates());
  const advocateIds = new Map(staff.map((person) => [person.name, person.id]));
  const caseIdsByNumber = new Map(
    CASES.map((legalCase) => [
      legalCase.number,
      stableId("case", legalCase.id),
    ]),
  );
  const register = right(documents(caseIdsByNumber, advocateIds));

  it("adapts every document the prototype recorded", () => {
    expect(register).toHaveLength(8);
  });

  /**
   * The property the whole slice rests on.
   *
   * Every version claims a storage key, and the seed uploads a body for each
   * of those keys. If the two lists ever drift apart, the register offers a
   * download that 404s — which is the failure the ordering in `upload` and in
   * the seed script exists to prevent. Testing it here means the drift is
   * caught before anything reaches Neon or the blob store.
   */
  it("promises a body for every version, and no bodies besides", () => {
    for (const entry of register) {
      expect(entry.bodies.map((body) => body.key)).toStrictEqual(
        entry.document.versions.map((version) => version.storageKey),
      );
    }
  });

  /**
   * The row and the object have to agree about how big the object is.
   *
   * This adapter invented sizes — forty-odd kilobytes, varied per document so
   * the register would not show one suspicious figure on every row — while the
   * bodies it uploaded were about 470 bytes each. The register duly displayed
   * "65 KB" next to a half-kilobyte object, and nothing caught it: the row
   * decoded, the upload succeeded, the download worked. It took fetching every
   * seeded document out of the real blob store and comparing lengths.
   *
   * So the invariant is asserted here, where it costs a millisecond.
   */
  it("records the size of the body it actually uploads", () => {
    for (const entry of register) {
      for (const [index, version] of entry.document.versions.entries()) {
        expect(version.sizeBytes).toBe(entry.bodies[index]?.body.byteLength);
      }
    }
  });

  it("writes a body that says it is a placeholder", () => {
    const [first] = register;
    const body = new TextDecoder().decode(first!.bodies[0]!.body);

    expect(body).toContain("SEEDED PLACEHOLDER");
    expect(body).toContain(first!.document.name);
  });

  /**
   * The keys have to match what `DocumentService` derives, or an uploaded
   * revision of a seeded document lands somewhere else entirely.
   */
  it("derives keys the way the service derives them", () => {
    for (const { document } of register) {
      for (const version of document.versions) {
        expect(version.storageKey).toBe(
          `matters/${document.caseId}/${document.id}/v${String(version.number)}`,
        );
      }
    }
  });

  it("numbers versions from one, in order, with no gaps", () => {
    for (const { document } of register) {
      expect(document.versions.map((version) => version.number)).toStrictEqual(
        document.versions.map((_, index) => index + 1),
      );
    }
  });

  it("dates versions oldest first, so the latest is the current one", () => {
    for (const { document } of register) {
      const dates = document.versions.map((version) =>
        version.uploadedOn.getTime(),
      );
      expect(dates).toStrictEqual([...dates].sort((a, b) => a - b));
      expect(Documents.currentVersion(document).uploadedOn.getTime()).toBe(
        Math.max(...dates),
      );
    }
  });

  /**
   * "Final" is the prototype's word for a judgment, and the domain has no such
   * status. Mapping it to `Not required` is a decision recorded in the
   * supplement; this asserts the decision took effect rather than the value
   * falling through to something else.
   */
  it("does not claim the firm is waiting to sign a judgment", () => {
    const judgment = register.find(({ document }) =>
      document.name.startsWith("Judgment"),
    );

    expect(judgment?.document.signatureStatus).toBe("Not required");
  });

  it("carries the prototype's pending signatures across", () => {
    const awaiting = Documents.awaitingSignature(
      register.map((entry) => entry.document),
    );

    expect(awaiting.map((document) => document.name)).toStrictEqual([
      "Master Services Agreement - Zenith.docx",
      "Employment Contract - Rift Valley.pdf",
    ]);
  });

  /**
   * A filed document is fixed, so seeding one that could still be revised
   * would leave the append-only rule untested against real data — and seeding
   * everything as filed would make every revision refuse.
   */
  it("seeds both a filed document and a revisable one", () => {
    const filed = register.filter(({ document }) => document.filedWithCourt);

    expect(filed.length).toBe(FILED_WITH_COURT.size);
    expect(filed.length).toBeGreaterThan(0);
    expect(filed.length).toBeLessThan(register.length);
  });

  it("refuses to revise the ones it filed", () => {
    for (const { document } of register) {
      const revised = Documents.addVersion(document, {
        storageKey: "matters/x/y/v9",
        sizeBytes: 10,
        uploadedBy: document.versions[0].uploadedBy,
        uploadedOn: new Date(),
      });

      expect(Either.isLeft(revised)).toBe(document.filedWithCourt);
    }
  });

  it("attributes every version to the advocate who carries the matter", () => {
    const names = new Map(staff.map((person) => [person.id, person.name]));

    for (const { document } of register) {
      const matter = CASES.find(
        (legalCase) => stableId("case", legalCase.id) === document.caseId,
      );

      for (const version of document.versions) {
        expect(names.get(version.uploadedBy)).toBe(matter?.advocate);
      }
    }
  });
});

describe("the work list", () => {
  const staff = right(advocates());
  const advocateIds = new Map(staff.map((person) => [person.name, person.id]));
  const caseIdsByNumber = new Map(
    CASES.map((legalCase) => [
      legalCase.number,
      stableId("case", legalCase.id),
    ]),
  );
  const list = right(tasks(caseIdsByNumber, advocateIds));

  it("adapts every task the prototype recorded", () => {
    expect(list).toHaveLength(8);
  });

  /**
   * **The prototype's own data is inconsistent, and the import surfaces it.**
   *
   * `TASKS` assigns the registry filing to "Clerk - James"; `STAFF`, in the
   * same prototype, contains nobody by that name. The task list and the staff
   * list disagree, which matters because the domain's rule is that work goes to
   * a named person on the staff list — a task assigned to somebody who is not
   * there looks assigned in every list and is being done by nobody.
   *
   * Resolved by a recorded decision in `TASK_ASSIGNEES`, not by a fallback.
   */
  it("does not assign work to somebody who is not at the firm", () => {
    const names = new Map(staff.map((person) => [person.id, person.name]));

    for (const task of list) {
      expect(names.has(task.assignedTo)).toBe(true);
    }

    const registry = list.find((task) =>
      task.title.startsWith("File documents"),
    );
    expect(names.get(registry!.assignedTo)).toBe("Legal Assistant - Mercy");
  });

  /**
   * The prototype's one task with no matter — reconciling the trust account —
   * survives as firm work rather than being dropped. The time adapter drops
   * the equivalent row, and the difference is deliberate: unattributed time is
   * a hole in the billing record, and unattributed work is just work.
   */
  it("keeps firm work that has no matter behind it", () => {
    const chore = list.find((task) => Option.isNone(task.caseId));

    expect(chore?.title).toBe("Reconcile trust account");
  });

  /** Everything else is on a matter that was actually seeded. */
  it("puts every other task on a seeded matter", () => {
    const seeded = new Set(caseIdsByNumber.values());

    for (const task of list) {
      if (Option.isSome(task.caseId)) {
        expect(seeded.has(task.caseId.value)).toBe(true);
      }
    }
  });

  /**
   * `Scheduled` is dropped rather than renamed: it was never a state of the
   * work, it was the presence of a date, and every task has a due date. The one
   * task carrying it is "Attend hearing" — a court date, which the diary owns.
   */
  it("does not carry a status the domain does not have", () => {
    const hearing = list.find((task) => task.title === "Attend hearing");

    expect(hearing?.status).toBe("In progress");
    for (const task of list) {
      expect(["Not started", "In progress", "Done"]).toContain(task.status);
    }
  });

  /**
   * The domain refuses a task due before it was raised, and the prototype
   * records only a due date. Deriving `raisedOn` a week earlier is a stated
   * assumption; raising everything on the day the seed runs would make every
   * task look new and leave the field meaningless.
   */
  it("raises every task before it falls due", () => {
    for (const task of list) {
      expect(task.raisedOn.getTime()).toBeLessThan(task.dueOn.getTime());
    }
  });

  it("seeds nothing as done, because the prototype says nothing about who or when", () => {
    for (const task of list) {
      expect(task.status).not.toBe("Done");
      expect(Option.isNone(task.completed)).toBe(true);
    }
  });

  /**
   * The seeded work has to actually exercise the screens: something overdue,
   * something due soon, and both priorities represented — otherwise the demo
   * shows one list and the other two are empty.
   */
  it("spans the boundaries the work list splits on", () => {
    const asAt = new Date("2026-08-21T09:00:00.000Z");

    expect(Work.overdue(list, asAt).length).toBeGreaterThan(0);
    expect(Work.dueWithin(list, asAt, 7).length).toBeGreaterThan(0);
    expect(new Set(list.map((task) => task.priority)).size).toBeGreaterThan(1);
  });
});

describe("the seeded client threads", () => {
  const staff = right(advocates());
  const advocateIds = new Map(staff.map((person) => [person.name, person.id]));
  const firmClients = right(clients());
  const clientIdsByNumber = new Map(
    firmClients.map((client) => [client.number, client.id]),
  );
  const caseIdsByNumber = new Map(
    CASES.map((legalCase) => [
      legalCase.number,
      stableId("case", legalCase.id),
    ]),
  );
  const thread = right(
    messages(clientIdsByNumber, caseIdsByNumber, advocateIds),
  );

  it("seeds a thread for two clients", () => {
    expect(new Set(thread.map((message) => message.clientId)).size).toBe(2);
  });

  /**
   * A message from the firm names the advocate who wrote it; a message from a
   * client names nobody. `author_is_consistent` refuses anything else, so an
   * adapter that got this wrong would fail at the database rather than here.
   */
  it("names somebody on every message from the firm, and nobody on any from a client", () => {
    const known = new Set(staff.map((person) => person.id));

    for (const message of thread) {
      if (message.author._tag === "FromFirm") {
        expect(known.has(message.author.advocateId)).toBe(true);
      } else {
        expect(Object.keys(message.author)).toStrictEqual(["_tag"]);
      }
    }
  });

  /**
   * **The shape the whole module is demonstrated by.**
   *
   * One client waiting on a reply and one not — a `waiting()` that returned
   * everything would be visibly wrong against this data, and one that returned
   * nothing would be equally wrong.
   */
  it("leaves exactly one client waiting on a reply", () => {
    const byClient = new Map<string, typeof thread>();
    for (const message of thread) {
      byClient.set(message.clientId, [
        ...(byClient.get(message.clientId) ?? []),
        message,
      ]);
    }

    const waiting = [...byClient.values()].filter((each) =>
      Option.isSome(Correspondence.awaitingReply(each)),
    );

    expect(waiting).toHaveLength(1);
  });

  /**
   * And that client's oldest unanswered message has been **read**. That is the
   * case every unread badge reports as clear, so seeding it unread would leave
   * the interesting half of the report undemonstrated.
   */
  it("leaves that client's question read and unanswered", () => {
    const waiting = Correspondence.awaitingReply(thread);

    expect(Option.isSome(waiting)).toBe(true);
    expect(Correspondence.isRead(Option.getOrThrow(waiting))).toBe(true);
  });

  it("never records a message as read before it was sent", () => {
    for (const message of thread) {
      if (Option.isSome(message.readAt)) {
        expect(message.readAt.value.getTime()).toBeGreaterThanOrEqual(
          message.sentAt.getTime(),
        );
      }
    }
  });

  /**
   * A message filed against a matter belonging to a *different* client would
   * put one client's matter in front of another. `MessageService.send` refuses
   * it at runtime; this is the same check against the seeded data, which never
   * goes through that path.
   */
  it("puts every matter-filed message on that client's own matter", () => {
    const firmMatters = right(
      matters(
        clientIdsByPrototypeKey(),
        new Map(staff.map((person) => [person.name, person.id])),
      ),
    );
    const owners = new Map(
      firmMatters.map((matter) => [matter.id, matter.clientId]),
    );

    let checked = 0;

    for (const message of thread) {
      if (Option.isSome(message.caseId)) {
        expect(owners.get(message.caseId.value)).toBe(message.clientId);
        checked += 1;
      }
    }

    // The assertion is worthless if nothing in the thread names a matter.
    expect(checked).toBeGreaterThan(0);
  });
});
