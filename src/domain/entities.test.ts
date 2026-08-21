import { Either, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";
import * as Client from "./client/client";
import * as Court from "./court/court";
import * as Hearing from "./court/hearing";
import * as Document from "./document/document";
import * as Advocate from "./firm/advocate";
import {
  AdvocateId,
  CaseId,
  ClientId,
  DocumentId,
  HearingId,
  InvoiceId,
  KenyanPhone,
  normalisePhone,
  phoneKind,
  KraPin,
  TimeEntryId,
} from "./shared/ids";
import * as Money from "./shared/money";
import * as Time from "./time/entry";

const uuid = (prefix: string, n = 1) =>
  `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const clientId = Schema.decodeSync(ClientId)(uuid("0"));
const caseId = Schema.decodeSync(CaseId)(uuid("2"));
const advocateId = Schema.decodeSync(AdvocateId)(uuid("4"));
const hearingId = Schema.decodeSync(HearingId)(uuid("5"));
const documentId = Schema.decodeSync(DocumentId)(uuid("6"));
const timeEntryId = Schema.decodeSync(TimeEntryId)(uuid("7"));
const invoiceId = Schema.decodeSync(InvoiceId)(uuid("8"));
const otherInvoiceId = Schema.decodeSync(InvoiceId)(uuid("8", 2));

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

// ── Client ────────────────────────────────────────────────────────────────

describe("Client", () => {
  const individual: Client.Client = {
    _tag: "Individual",
    id: clientId,
    number: "CLT-1001",
    name: "Wanjiku Mwangi",
    email: "wanjiku.m@example.co.ke",
    phone: Schema.decodeSync(KenyanPhone)("+254722445109"),
    onboardedOn: utc("2026-01-10"),
  };

  it("requires a corporate client to name someone who can instruct", () => {
    const result = Schema.decodeUnknownEither(Client.Corporate)({
      _tag: "Corporate",
      id: clientId,
      number: "CLT-2001",
      name: "General Innovations Ltd",
      email: "legal@example.co.ke",
      phone: "+254722445109",
      onboardedOn: utc("2026-01-10"),
      contacts: [],
    });

    expect(Either.isLeft(result)).toBe(true);
  });

  it("accepts an individual with no contacts field at all", () => {
    expect(individual._tag).toBe("Individual");
    expect(Client.primaryContact(individual)).toBe("Wanjiku Mwangi");
  });

  it("flags an individual holding an entity PIN", () => {
    // A `P` PIN on a person usually means a sole trader was entered as a
    // company, or a director's own PIN was captured instead of the company's.
    const wrong: Client.Client = {
      ...individual,
      kraPin: Schema.decodeSync(KraPin)("P012345678Z"),
    };

    const error = Option.getOrThrow(Either.getLeft(Client.checkPin(wrong)));
    expect(error._tag).toBe("PinDoesNotMatchClientType");
    expect(error.reason).toContain("should begin with A");
  });

  it("accepts a matching PIN", () => {
    const right: Client.Client = {
      ...individual,
      kraPin: Schema.decodeSync(KraPin)("A012345678Z"),
    };

    expect(Either.isRight(Client.checkPin(right))).toBe(true);
  });

  it("says nothing when no PIN is recorded", () => {
    expect(Either.isRight(Client.checkPin(individual))).toBe(true);
  });
});

// ── Time ──────────────────────────────────────────────────────────────────

describe("TimeEntry", () => {
  const entry: Time.TimeEntry = {
    id: timeEntryId,
    caseId,
    advocateId,
    activity: "Drafting",
    minutes: 90,
    workedOn: utc("2026-08-19"),
    billable: true,
    hourlyRateCents: 20_000_00,
    narrative: "Drafting the plaint",
    invoicedOn: Option.none(),
  };

  it("values billable time at the hourly rate", () => {
    expect(Time.value(entry)).toBe(Money.fromCents(30_000_00));
    expect(Time.hours(entry)).toBe(1.5);
  });

  it("values non-billable time at nothing", () => {
    expect(Time.value({ ...entry, billable: false })).toBe(Money.zero);
  });

  it("still counts non-billable time toward utilisation", () => {
    const entries = [entry, { ...entry, billable: false, minutes: 30 }];
    expect(Time.totalMinutes(entries)).toBe(120);
    expect(Time.utilisation(entries)).toBe(0.75);
  });

  it("reports zero utilisation rather than NaN for no entries", () => {
    expect(Time.utilisation([])).toBe(0);
  });

  it("refuses to invoice the same work twice, and names the fee note", () => {
    const invoiced = Either.getOrThrow(Time.markInvoiced(entry, invoiceId));
    expect(Option.getOrNull(invoiced.invoicedOn)).toBe(invoiceId);

    const again = Time.markInvoiced(invoiced, otherInvoiceId);

    const error = Option.getOrThrow(Either.getLeft(again));
    expect(error._tag).toBe("AlreadyInvoiced");
    expect(error.reason).toContain("double-charge");
    /**
     * The fee note it is *already* on, not the one being attempted. Somebody
     * who hits this needs to go and look at the first one.
     */
    if (error._tag === "AlreadyInvoiced") {
      expect(error.invoiceId).toBe(invoiceId);
    }
  });

  /**
   * A write-off is a decision, and billing it anyway would reverse that
   * decision without anybody choosing to. `only_billable_time_is_invoiced`
   * says the same thing in Postgres.
   */
  it("refuses to carry non-billable work onto a fee note", () => {
    const written = Time.markInvoiced({ ...entry, billable: false }, invoiceId);

    const error = Option.getOrThrow(Either.getLeft(written));
    expect(error._tag).toBe("NotBillable");
  });

  it("lists only unbilled billable time for a matter", () => {
    const entries = [
      entry,
      { ...entry, invoicedOn: Option.some(invoiceId) },
      { ...entry, billable: false },
    ];

    expect(Time.unbilledFor(entries, caseId)).toHaveLength(1);
  });
});

// ── Hearing ───────────────────────────────────────────────────────────────

describe("Hearing", () => {
  const court: Court.Court = {
    _tag: "MagistratesCourt",
    station: "Milimani",
    rank: "Principal Magistrate",
  };

  const hearing: Hearing.Hearing = {
    id: hearingId,
    caseId,
    kind: "Mention",
    court,
    scheduledFor: utc("2026-08-20"),
    advocateId,
  };

  it("cannot record an adjournment without a date to adjourn to", () => {
    // The Outcome union has no Adjourned variant lacking adjournedTo, so this
    // is a decode failure rather than something to check at runtime.
    const result = Schema.decodeUnknownEither(Hearing.Outcome)({
      _tag: "Adjourned",
      reason: "Court not sitting",
    });

    expect(Either.isLeft(result)).toBe(true);
  });

  it("records an adjournment that moves the matter forward", () => {
    const result = Hearing.recordOutcome(hearing, {
      _tag: "Adjourned",
      adjournedTo: utc("2026-09-15"),
      reason: "Court not sitting",
    });

    const updated = Either.getOrThrow(result);
    expect(Hearing.adjournedTo(updated)?.toISOString().slice(0, 10)).toBe(
      "2026-09-15",
    );
  });

  it("refuses an adjournment into the past", () => {
    const result = Hearing.recordOutcome(hearing, {
      _tag: "Adjourned",
      adjournedTo: utc("2025-09-15"),
      reason: "Year typed wrong",
    });

    const error = Option.getOrThrow(Either.getLeft(result));
    expect(error._tag).toBe("AdjournedIntoThePast");
  });

  it("surfaces past hearings with no outcome recorded", () => {
    const heard = Either.getOrThrow(
      Hearing.recordOutcome(hearing, { _tag: "Heard" }),
    );
    const forgotten = {
      ...hearing,
      id: hearingId,
      scheduledFor: utc("2026-08-01"),
    };

    const pending = Hearing.awaitingOutcome(
      [heard, forgotten],
      utc("2026-08-25"),
    );

    expect(pending).toHaveLength(1);
    expect(pending[0]?.scheduledFor).toStrictEqual(utc("2026-08-01"));
  });

  it("lists upcoming hearings soonest first", () => {
    const later = { ...hearing, scheduledFor: utc("2026-10-01") };
    const sooner = { ...hearing, scheduledFor: utc("2026-08-25") };

    const list = Hearing.upcoming([later, sooner], utc("2026-08-20"));
    expect(list[0]?.scheduledFor).toStrictEqual(utc("2026-08-25"));
  });
});

// ── Advocate ──────────────────────────────────────────────────────────────

describe("Advocate", () => {
  const advocate: Advocate.Advocate = {
    id: advocateId,
    name: "Sarah Wanjiru",
    role: "Advocate",
    email: "sarah@example.co.ke",
    practisingCertificate: { number: "PC/2026/0041", year: 2026 },
    admittedOn: utc("2014-11-20"),
    active: true,
  };

  it("lets a certificated advocate appear", () => {
    expect(Advocate.mayAppearInCourt(advocate, utc("2026-08-19"))).toBe(true);
  });

  it("stops them once the certificate year has rolled over", () => {
    // The lapse a firm discovers on the morning of the hearing.
    expect(Advocate.mayAppearInCourt(advocate, utc("2027-01-05"))).toBe(false);
  });

  it("stops a legal assistant regardless of anything else", () => {
    const assistant = { ...advocate, role: "Legal Assistant" as const };
    expect(Advocate.mayAppearInCourt(assistant, utc("2026-08-19"))).toBe(false);
  });

  it("stops an inactive advocate", () => {
    expect(
      Advocate.mayAppearInCourt(
        { ...advocate, active: false },
        utc("2026-08-19"),
      ),
    ).toBe(false);
  });

  it("reports who needs a renewal for the coming year", () => {
    const lapsed = Advocate.certificateLapsed([advocate], utc("2027-01-05"));
    expect(lapsed).toHaveLength(1);
  });
});

// ── Document ──────────────────────────────────────────────────────────────

describe("Document", () => {
  const document: Document.Document = {
    id: documentId,
    caseId,
    name: "Plaint.pdf",
    category: "Pleadings",
    signatureStatus: "Signed",
    filedWithCourt: false,
    versions: [
      {
        number: 1,
        storageKey: "cases/1/plaint-v1.pdf",
        sizeBytes: 12_400,
        uploadedBy: advocateId,
        uploadedOn: utc("2026-02-18"),
      },
    ],
  };

  it("assigns version numbers itself rather than trusting the caller", () => {
    const updated = Either.getOrThrow(
      Document.addVersion(document, {
        storageKey: "cases/1/plaint-v2.pdf",
        sizeBytes: 12_900,
        uploadedBy: advocateId,
        uploadedOn: utc("2026-02-20"),
      }),
    );

    expect(Document.versionCount(updated)).toBe(2);
    expect(Document.currentVersion(updated).number).toBe(2);
  });

  it("keeps earlier versions rather than replacing them", () => {
    const updated = Either.getOrThrow(
      Document.addVersion(document, {
        storageKey: "cases/1/plaint-v2.pdf",
        sizeBytes: 12_900,
        uploadedBy: advocateId,
        uploadedOn: utc("2026-02-20"),
      }),
    );

    expect(updated.versions[0]?.storageKey).toBe("cases/1/plaint-v1.pdf");
  });

  it("refuses to revise a document already filed with the court", () => {
    const filed = { ...document, filedWithCourt: true };
    const result = Document.addVersion(filed, {
      storageKey: "cases/1/plaint-v2.pdf",
      sizeBytes: 12_900,
      uploadedBy: advocateId,
      uploadedOn: utc("2026-02-20"),
    });

    const error = Option.getOrThrow(Either.getLeft(result));
    expect(error._tag).toBe("CannotReviseFiledDocument");
    expect(error.reason).toContain("fresh document");
  });

  it("rejects a document with no versions", () => {
    const result = Schema.decodeUnknownEither(Document.Document)({
      ...document,
      versions: [],
    });

    expect(Either.isLeft(result)).toBe(true);
  });
});

/**
 * The phone number widened from mobile-only when the seed import ran into it:
 * a firm holds a switchboard number for a corporate client, and a type that
 * cannot represent one forces the number to be falsified or dropped.
 *
 * Widening a validator is the easy half. The half worth testing is that it
 * still refuses what it refused before, and that the distinction it used to
 * enforce is still *knowable* — Phase 7 texts hearing reminders, and a landline
 * cannot receive one.
 */
describe("KenyanPhone", () => {
  const decode = Schema.decodeUnknownEither(KenyanPhone);

  it.each([
    ["+254722445109", "mobile"],
    ["+254733208771", "mobile"],
    ["+254111234567", "mobile"],
    ["+254204453021", "fixed line"],
    ["+254412207743", "fixed line"],
    ["+254512218890", "fixed line"],
  ])("accepts %s and reads it as a %s", (input, kind) => {
    const result = decode(input);

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) expect(phoneKind(result.right)).toBe(kind);
  });

  it.each([
    "+2540722445109",
    "+254722445",
    "+25472244510912",
    "+447700900000",
    "0722445109",
    "254722445109",
    "+254 722 445 109",
    "",
  ])("refuses %o", (input) => {
    expect(Either.isLeft(decode(input))).toBe(true);
  });

  /**
   * `normalisePhone` is the lenient half, and it has to stay lenient about the
   * shapes people type without becoming lenient about what gets stored.
   */
  it("normalises what a receptionist actually types", () => {
    expect(normalisePhone("0722 445 109")).toBe("+254722445109");
    expect(normalisePhone("254722445109")).toBe("+254722445109");
    expect(normalisePhone("+254 (20) 445-3021")).toBe("+254204453021");
  });
});
