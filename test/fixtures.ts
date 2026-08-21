import { Option, Schema } from "effect";
import type * as Billing from "@/domain/billing/invoice";
import type * as Matter from "@/domain/case/case";
import type * as Client from "@/domain/client/client";
import type * as Firm from "@/domain/firm/advocate";
import type * as Ledger from "@/domain/trust/ledger";
import * as Court from "@/domain/court/court";
import * as Hearing from "@/domain/court/hearing";
import type * as Documents from "@/domain/document/document";
import type * as Time from "@/domain/time/entry";
import type * as Work from "@/domain/work/task";
import type * as Correspondence from "@/domain/message/message";
import type * as Log from "@/domain/firm/contact";
import type * as Library from "@/domain/firm/precedent";
import * as Identity from "@/domain/identity/principal";
import {
  AdvocateId,
  CaseId,
  CaseNumber,
  ClientId,
  ContactId,
  InvoiceId,
  DocumentId,
  MessageId,
  PrecedentId,
  HearingId,
  KenyanPhone,
  TaskId,
  TimeEntryId,
  TrustMovementId,
  UserId,
} from "@/domain/shared/ids";

/**
 * Domain values for tests that need a populated firm.
 *
 * Built by hand rather than imported from the seed adapter: a test that shares
 * fixtures with the seed script stops being able to tell them apart, and the
 * failure mode is a suite that only proves the two agree with each other.
 *
 * Dates are fixed and UTC. `THE_YEAR` is the year the practising certificates
 * below cover, and tests that care set the `TestClock` to `TODAY` so "does this
 * advocate hold a current certificate" has a deterministic answer.
 */

export const THE_YEAR = 2026;
export const TODAY = new Date(`${THE_YEAR}-08-19T09:00:00Z`);

export const utc = (day: string) => new Date(`${day}T00:00:00Z`);

const caseId = (n: number) =>
  Schema.decodeSync(CaseId)(`20000000-0000-4000-8000-00000000000${n}`);
const clientId = (n: number) =>
  Schema.decodeSync(ClientId)(`00000000-0000-4000-8000-00000000000${n}`);
const advocateId = (n: number) =>
  Schema.decodeSync(AdvocateId)(`40000000-0000-4000-8000-00000000000${n}`);
const invoiceId = (n: number) =>
  Schema.decodeSync(InvoiceId)(`60000000-0000-4000-8000-00000000000${n}`);
const movementId = (n: number) =>
  Schema.decodeSync(TrustMovementId)(`70000000-0000-4000-8000-00000000000${n}`);
const documentId = (n: number) =>
  Schema.decodeSync(DocumentId)(`a0000000-0000-4000-8000-00000000000${n}`);
const hearingId = (n: number) =>
  Schema.decodeSync(HearingId)(`90000000-0000-4000-8000-00000000000${n}`);
const timeEntryId = (n: number) =>
  Schema.decodeSync(TimeEntryId)(`80000000-0000-4000-8000-00000000000${n}`);
const phone = (digits: string) => Schema.decodeSync(KenyanPhone)(digits);

// ── Staff ─────────────────────────────────────────────────────────────────

/** Holds a current certificate, so she may file. */
export const sarah: Firm.Advocate = {
  id: advocateId(1),
  name: "Adv. Sarah Wanjiru",
  role: "Advocate",
  email: "sarah@oklaw.co.ke",
  practisingCertificate: { number: "PC/2026/0412", year: THE_YEAR },
  admittedOn: utc("2016-11-04"),
  active: true,
};

/** Does the work, may not appear: no certificate, and not an advocate's role. */
export const grace: Firm.Advocate = {
  id: advocateId(2),
  name: "Grace Njoki",
  role: "Legal Assistant",
  email: "grace@oklaw.co.ke",
  active: true,
};

/** Left the firm. Still referenced by old matters, assignable to none. */
export const daniel: Firm.Advocate = {
  id: advocateId(3),
  name: "Adv. Daniel Mutiso",
  role: "Advocate",
  email: "daniel@oklaw.co.ke",
  practisingCertificate: { number: "PC/2026/0518", year: THE_YEAR },
  admittedOn: utc("2011-06-17"),
  active: false,
};

/** An advocate whose certificate lapsed with the year. */
export const lapsed: Firm.Advocate = {
  id: advocateId(4),
  name: "Adv. Peter Kariuki",
  role: "Advocate",
  email: "peter@oklaw.co.ke",
  practisingCertificate: { number: "PC/2025/0233", year: THE_YEAR - 1 },
  admittedOn: utc("2009-02-20"),
  active: true,
};

export const advocates = [sarah, grace, daniel, lapsed];

// ── Clients ───────────────────────────────────────────────────────────────

export const wanjiku: Client.Client = {
  _tag: "Individual",
  id: clientId(1),
  number: "CLT-1001",
  name: "Wanjiku Mwangi",
  email: "wanjiku.mwangi@example.co.ke",
  phone: phone("+254722445109"),
  onboardedOn: utc("2024-03-11"),
};

export const zenith: Client.Client = {
  _tag: "Corporate",
  id: clientId(2),
  number: "CLT-2001",
  name: "Zenith Distributors Ltd",
  email: "legal@zenith.co.ke",
  phone: phone("+254204453021"),
  onboardedOn: utc("2023-09-14"),
  contacts: [
    {
      name: "Eunice Wambui",
      role: "Company Secretary",
      phone: phone("+254722310884"),
    },
  ],
};

export const clients = [wanjiku, zenith];

// ── Matters ───────────────────────────────────────────────────────────────

export const filedMatter: Matter.Case = {
  id: caseId(1),
  number: Schema.decodeSync(CaseNumber)("OKL-2026-014"),
  causeNumber: "MCCC E0412 of 2026",
  title: "Wanjiku Mwangi v. Nairobi Metro SACCO",
  opposingParties: ["Nairobi Metro SACCO"],
  type: "Civil",
  status: "Hearing Scheduled",
  clientId: wanjiku.id,
  advocateId: sarah.id,
  court: {
    _tag: "MagistratesCourt",
    station: "Milimani",
    rank: "Chief Magistrate",
  },
  claimValueCents: 4_200_000_00,
  underCustomaryLaw: false,
  accruedOn: utc("2024-08-30"),
  limitationBasis: "contract",
  openedOn: utc("2026-01-19"),
  filedOn: utc("2026-02-14"),
};

export const unfiledMatter: Matter.Case = {
  id: caseId(2),
  number: Schema.decodeSync(CaseNumber)("OKL-2026-032"),
  title: "Zenith Distributors Ltd — supply contract review",
  opposingParties: ["Coastal Freight Ltd"],
  type: "Commercial",
  status: "New",
  clientId: zenith.id,
  advocateId: grace.id,
  claimValueCents: 7_650_000_00,
  underCustomaryLaw: false,
  openedOn: utc("2026-03-16"),
};

/**
 * Filed in 2025 and carried by the advocate whose certificate is a 2025 one.
 *
 * Deliberate: it is the case that distinguishes "may file" from "may edit a
 * file". The certificate on record no longer covers today, and amending an old
 * matter must not be blocked by that — only filing must.
 */
export const closedMatter: Matter.Case = {
  id: caseId(3),
  number: Schema.decodeSync(CaseNumber)("OKL-2025-098"),
  title: "In re Estate of Njeri Kamau",
  // A probate application is not against anybody. Empty is the truth, and the
  // conflict screen has to cope with it.
  opposingParties: [],
  type: "Probate",
  status: "Closed",
  clientId: wanjiku.id,
  advocateId: lapsed.id,
  court: { _tag: "HighCourt", station: "Milimani", division: "Family" },
  underCustomaryLaw: false,
  openedOn: utc("2025-09-08"),
  filedOn: utc("2025-10-20"),
};

export const matters = [filedMatter, unfiledMatter, closedMatter];

// ── Fee notes ─────────────────────────────────────────────────────────────

/**
 * Three invoices chosen to land on three different derived statuses as at
 * `TODAY`, because the status is never stored and a fixture that only ever
 * produced one of them would leave the derivation untested.
 */

/** Paid in full: two lines, one M-Pesa payment covering the total. */
export const settledInvoice: Billing.Invoice = {
  id: invoiceId(1),
  number: "INV-1001",
  clientId: wanjiku.id,
  caseId: filedMatter.id,
  issuedOn: utc("2026-05-04"),
  dueOn: utc("2026-06-03"),
  lines: [
    {
      description: "Drafting plaint and verifying affidavit",
      quantityHundredths: 400,
      unitPriceCents: 1_500_00,
    },
    {
      description: "Court filing fees (disbursement)",
      quantityHundredths: 100,
      unitPriceCents: 5_000_00,
    },
  ],
  payments: [
    {
      amountCents: 11_000_00,
      method: "M-Pesa",
      receivedOn: utc("2026-05-29"),
      reference: "SFH4KJ2L91",
    },
  ],
};

/** Issued and due before `TODAY` with nothing paid: derives to Overdue. */
export const overdueInvoice: Billing.Invoice = {
  id: invoiceId(2),
  number: "INV-1002",
  clientId: zenith.id,
  caseId: unfiledMatter.id,
  issuedOn: utc("2026-06-15"),
  dueOn: utc("2026-07-15"),
  lines: [
    {
      description: "Supply agreement review and advice",
      quantityHundredths: 650,
      unitPriceCents: 2_000_00,
    },
  ],
  payments: [],
};

/** Part paid and not yet due: derives to Partially Paid. */
export const partPaidInvoice: Billing.Invoice = {
  id: invoiceId(3),
  number: "INV-1003",
  clientId: zenith.id,
  issuedOn: utc("2026-08-03"),
  dueOn: utc("2026-09-02"),
  lines: [
    {
      description: "Retainer — August 2026",
      quantityHundredths: 100,
      unitPriceCents: 8_000_00,
    },
  ],
  payments: [
    {
      amountCents: 3_000_00,
      method: "Bank Transfer",
      receivedOn: utc("2026-08-10"),
      reference: "FT26222XY41",
    },
  ],
};

export const invoices = [settledInvoice, overdueInvoice, partPaidInvoice];

// ── Client money ──────────────────────────────────────────────────────────

/**
 * A trust ledger with one funded client and one who has nothing.
 *
 * Zenith holds KES 250,000 against `overdueInvoice`'s KES 130,000, so a
 * settlement out of it succeeds; Wanjiku has never paid anything into client
 * account, so the same settlement against her fee note is refused under Rule
 * 10. Both cases are needed and neither is the interesting one on its own —
 * a ledger where everything succeeds tests the same code path as no ledger
 * at all.
 */
export const zenithDeposit: Ledger.TrustMovement = {
  id: movementId(1),
  clientId: zenith.id,
  reason: "Deposit received",
  amount: 250_000_00,
  recordedAt: utc("2026-06-01"),
  reference: "Funds on account of costs",
};

export const movements = [zenithDeposit];

// ── Recorded work ─────────────────────────────────────────────────────────

/**
 * Four entries on `unfiledMatter`, chosen so that every branch of the billing
 * and utilisation logic has something to act on: two billable at one rate, one
 * billable at another, and one non-billable.
 *
 * The two rates matter. `linesFrom` groups by activity *and* rate, so a fixture
 * with a single rate could not tell a correct grouping from one that merged two
 * fee-earners' work into a line priced at whichever rate it saw last.
 */
export const draftingTime: Time.TimeEntry = {
  id: timeEntryId(1),
  caseId: unfiledMatter.id,
  advocateId: sarah.id,
  activity: "Drafting",
  minutes: 150,
  workedOn: utc("2026-08-10"),
  billable: true,
  hourlyRateCents: 20_000_00,
  narrative: "Drafting the supply agreement schedules",
  invoicedOn: Option.none(),
};

export const moreDraftingTime: Time.TimeEntry = {
  ...draftingTime,
  id: timeEntryId(2),
  minutes: 90,
  workedOn: utc("2026-08-12"),
  narrative: "Revising the schedules after comments",
};

/** Same activity, a different rate — so it must be its own line. */
export const juniorDraftingTime: Time.TimeEntry = {
  ...draftingTime,
  id: timeEntryId(3),
  advocateId: grace.id,
  minutes: 120,
  workedOn: utc("2026-08-13"),
  hourlyRateCents: 8_000_00,
  narrative: "Preparing the bundle",
};

/** Written off. Recorded anyway — utilisation cannot be computed without it. */
export const writtenOffTime: Time.TimeEntry = {
  ...draftingTime,
  id: timeEntryId(4),
  activity: "Administration",
  minutes: 60,
  workedOn: utc("2026-08-14"),
  billable: false,
  narrative: "File housekeeping",
};

// ── Court dates ───────────────────────────────────────────────────────────

/**
 * Three hearings chosen so every branch of the diary has something in it: one
 * still to come, one whose date has passed with nothing recorded — the report
 * that matters — and one already recorded.
 */
export const upcomingHearing: Hearing.Hearing = {
  id: hearingId(1),
  caseId: filedMatter.id,
  kind: "Mention",
  court: filedMatter.court as Court.Court,
  room: "14",
  scheduledFor: new Date("2026-09-04T06:00:00Z"),
  advocateId: sarah.id,
};

/** Past, and nothing recorded. This is what `awaitingOutcome` is for. */
export const missedHearing: Hearing.Hearing = {
  id: hearingId(2),
  caseId: filedMatter.id,
  kind: "Directions",
  court: filedMatter.court as Court.Court,
  scheduledFor: new Date("2026-08-12T06:00:00Z"),
  advocateId: sarah.id,
};

export const recordedHearing: Hearing.Hearing = {
  id: hearingId(3),
  caseId: unfiledMatter.id,
  kind: "Hearing",
  court: Court.HighCourt.make({
    station: "Milimani",
    division: "Commercial and Tax",
  }),
  scheduledFor: new Date("2026-07-22T06:00:00Z"),
  advocateId: grace.id,
  outcome: Hearing.Outcome.members[0].make({ note: "Judgment reserved" }),
};

export const courtDates = [upcomingHearing, missedHearing, recordedHearing];

// ── Documents ─────────────────────────────────────────────────────────────

/**
 * Two documents: one revised twice and one filed with the court.
 *
 * The filed one is the important fixture — it is the only way to test that
 * revision is refused, and a suite with only unfiled documents would leave the
 * rule that makes this module worth having entirely uncovered.
 */
export const draftPlaint: Documents.Document = {
  id: documentId(1),
  caseId: filedMatter.id,
  name: "Plaint and verifying affidavit",
  category: "Pleadings",
  signatureStatus: "Signed",
  filedWithCourt: false,
  versions: [
    {
      number: 1,
      storageKey: `matters/${filedMatter.id}/${documentId(1)}/v1`,
      sizeBytes: 84_213,
      uploadedBy: sarah.id,
      uploadedOn: utc("2026-02-10"),
    },
    {
      number: 2,
      storageKey: `matters/${filedMatter.id}/${documentId(1)}/v2`,
      sizeBytes: 86_902,
      uploadedBy: sarah.id,
      uploadedOn: utc("2026-02-12"),
    },
  ],
};

export const filedList: Documents.Document = {
  id: documentId(2),
  caseId: filedMatter.id,
  name: "List of documents",
  category: "Pleadings",
  signatureStatus: "Not required",
  filedWithCourt: true,
  versions: [
    {
      number: 1,
      storageKey: `matters/${filedMatter.id}/${documentId(2)}/v1`,
      sizeBytes: 12_004,
      uploadedBy: sarah.id,
      uploadedOn: utc("2026-02-14"),
    },
  ],
};

export const documents = [draftPlaint, filedList];

// ── Work ──────────────────────────────────────────────────────────────────

/**
 * Four tasks, arranged around the boundaries that matter.
 *
 * `dueToday` is the one worth having: at nine in the morning on the day it is
 * due it is *not* overdue, and a comparison against the moment of asking says
 * it is. `firmChore` has no matter at all — the trust reconciliation, which is
 * the prototype's own example of work with no file number and the reason
 * `caseId` is an `Option` here where it is `NOT NULL` on a time entry.
 */
const taskId = (n: number) =>
  Schema.decodeSync(TaskId)(`c0000000-0000-4000-8000-00000000000${n}`);

export const overdueTask: Work.Task = {
  id: taskId(1),
  title: "File the list of documents",
  caseId: Option.some(filedMatter.id),
  assignedTo: sarah.id,
  priority: "High",
  status: "In progress",
  raisedOn: utc("2026-08-10"),
  dueOn: utc("2026-08-17"),
  completed: Option.none(),
};

export const dueToday: Work.Task = {
  id: taskId(2),
  title: "Serve the hearing notice",
  caseId: Option.some(filedMatter.id),
  assignedTo: sarah.id,
  priority: "Medium",
  status: "Not started",
  // `TODAY` is 19 Aug 2026 at 09:00Z. Due *today*, and therefore not overdue.
  dueOn: utc("2026-08-19"),
  raisedOn: utc("2026-08-12"),
  completed: Option.none(),
};

export const firmChore: Work.Task = {
  id: taskId(3),
  title: "Reconcile the trust account",
  caseId: Option.none(),
  assignedTo: grace.id,
  priority: "Medium",
  status: "Not started",
  raisedOn: utc("2026-08-01"),
  dueOn: utc("2026-08-25"),
  completed: Option.none(),
};

export const doneTask: Work.Task = {
  id: taskId(4),
  title: "Draft the plaint",
  caseId: Option.some(filedMatter.id),
  assignedTo: sarah.id,
  priority: "High",
  status: "Done",
  raisedOn: utc("2026-08-01"),
  dueOn: utc("2026-08-12"),
  completed: Option.some({ on: utc("2026-08-11"), by: sarah.id }),
};

export const tasks = [overdueTask, dueToday, firmChore, doneTask];

// ── Correspondence ────────────────────────────────────────────────────────

/**
 * Two threads, arranged around the one report that matters.
 *
 * **Wanjiku is waiting**: she asked twice, the firm has said nothing since, and
 * her first message has been *read* — which is the case every unread badge
 * reports as clear and is the one most likely to end in a complaint.
 *
 * **Zenith is not waiting**: they asked and were answered. Both are needed, or
 * a `waiting()` that returned everything would pass.
 */
const messageId = (n: number) =>
  Schema.decodeSync(MessageId)(`d0000000-0000-4000-8000-00000000000${n}`);

export const firmOpener: Correspondence.Message = {
  id: messageId(1),
  clientId: wanjiku.id,
  caseId: Option.some(filedMatter.id),
  author: { _tag: "FromFirm", advocateId: sarah.id },
  body: "The plaint has been filed. I will confirm the hearing date.",
  sentAt: utc("2026-08-14"),
  readAt: Option.some(utc("2026-08-14")),
};

/** Read, and not answered. The worse of the two failures. */
export const clientAsked: Correspondence.Message = {
  id: messageId(2),
  clientId: wanjiku.id,
  caseId: Option.some(filedMatter.id),
  author: { _tag: "FromClient" },
  body: "Any news on the hearing date?",
  sentAt: utc("2026-08-17"),
  readAt: Option.some(utc("2026-08-17")),
};

export const clientChased: Correspondence.Message = {
  id: messageId(3),
  clientId: wanjiku.id,
  caseId: Option.none(),
  author: { _tag: "FromClient" },
  body: "Sorry to chase — is there any update?",
  sentAt: utc("2026-08-18"),
  readAt: Option.none(),
};

export const zenithAsked: Correspondence.Message = {
  id: messageId(4),
  clientId: zenith.id,
  caseId: Option.none(),
  author: { _tag: "FromClient" },
  body: "Could you resend last month's fee note?",
  sentAt: utc("2026-08-15"),
  readAt: Option.some(utc("2026-08-15")),
};

export const zenithAnswered: Correspondence.Message = {
  id: messageId(5),
  clientId: zenith.id,
  caseId: Option.none(),
  author: { _tag: "FromFirm", advocateId: grace.id },
  body: "Attached. Let me know if you need it broken down.",
  sentAt: utc("2026-08-16"),
  readAt: Option.none(),
};

export const messages = [
  firmOpener,
  clientAsked,
  clientChased,
  zenithAsked,
  zenithAnswered,
];

// ── The firm's own records ────────────────────────────────────────────────

/**
 * A contact log arranged so that "who have we neglected" has an answer.
 *
 * Wanjiku was called last week. Zenith was last spoken to in March. Grace has
 * **never** been contacted at all — the case that has to sort first, and the
 * reason `lastContact` is an `Option` rather than a date with a sentinel.
 */
const contactId = (n: number) =>
  Schema.decodeSync(ContactId)(`e0000000-0000-4000-8000-00000000000${n}`);

export const recentCall: Log.Contact = {
  id: contactId(1),
  clientId: wanjiku.id,
  caseId: Option.some(filedMatter.id),
  channel: "Call",
  direction: "Outgoing",
  loggedBy: sarah.id,
  summary: "Confirmed the hearing date and what to bring.",
  occurredOn: utc("2026-08-14"),
};

export const staleMeeting: Log.Contact = {
  id: contactId(2),
  clientId: zenith.id,
  caseId: Option.none(),
  channel: "Meeting",
  direction: "Incoming",
  loggedBy: grace.id,
  summary: "Walked through the supply agreement in the office.",
  occurredOn: utc("2026-03-02"),
};

export const contacts = [recentCall, staleMeeting];

/**
 * A precedent bank with one current entry and one nobody has looked at since
 * 2019. Both are needed: a staleness report that flagged everything would pass
 * against a bank of only old entries.
 */
const precedentId = (n: number) =>
  Schema.decodeSync(PrecedentId)(`f0000000-0000-4000-8000-00000000000${n}`);

export const currentPrecedent: Library.Precedent = {
  id: precedentId(1),
  title: "Employment Act, 2007 (annotated)",
  category: "Acts",
  location: "Shared drive · /precedents/employment",
  addedBy: sarah.id,
  addedOn: utc("2021-03-01"),
  reviewedOn: Option.some(utc("2026-06-01")),
  note: "Annotated against the 2024 amendments.",
};

export const stalePrecedent: Library.Precedent = {
  id: precedentId(2),
  title: "Land Registration Act, 2012 — transfer checklist",
  category: "Practice notes",
  location: "Lever-arch, second shelf",
  addedBy: grace.id,
  addedOn: utc("2019-05-14"),
  reviewedOn: Option.none(),
};

export const precedents = [currentPrecedent, stalePrecedent];

export const timeEntries = [
  draftingTime,
  moreDraftingTime,
  juniorDraftingTime,
  writtenOffTime,
];

// ── Principals ────────────────────────────────────────────────────────────

/**
 * Who is asking, for the tests that care — which, since Phase 6, is all of
 * them: `CurrentUser` is in the type of every service operation, so a test
 * cannot run one without saying who ran it.
 *
 * One per interesting role rather than one generic "user". The point of the
 * permission table is that the roles differ, and a suite with a single
 * all-powerful principal would exercise exactly none of that.
 */
const userId = (n: number) =>
  Schema.decodeSync(UserId)(`70000000-0000-4000-8000-00000000000${n}`);

export const asPartner: Identity.Staff = Identity.Staff.make({
  userId: userId(1),
  advocateId: sarah.id,
  name: "Adv. Amina Okwiri",
  email: "amina@oklaw.co.ke",
  role: "Managing Partner",
});

/** Sarah's own login: an Advocate, who may open and amend but not everything. */
export const asAdvocate: Identity.Staff = Identity.Staff.make({
  userId: userId(2),
  advocateId: sarah.id,
  name: sarah.name,
  email: sarah.email,
  role: "Advocate",
});

/** May see the money and may not touch a matter's lifecycle. */
export const asFinance: Identity.Staff = Identity.Staff.make({
  userId: userId(3),
  advocateId: grace.id,
  name: "Peter Njoroge",
  email: "peter.njoroge@oklaw.co.ke",
  role: "Finance Officer",
});

/** The least-privileged member of staff. */
export const asReceptionist: Identity.Staff = Identity.Staff.make({
  userId: userId(4),
  advocateId: grace.id,
  name: "Ann Mueni",
  email: "ann@oklaw.co.ke",
  role: "Receptionist",
});

/**
 * Wanjiku, signed in to the portal — and the reason every adversarial test in
 * this suite exists. Her client id is the only one she may see anything of.
 */
export const asWanjiku: Identity.PortalUser = Identity.PortalUser.make({
  userId: userId(5),
  clientId: wanjiku.id,
  name: wanjiku.name,
  email: wanjiku.email,
});

/** Zenith's portal login, so "the other client" is a real principal too. */
export const asZenith: Identity.PortalUser = Identity.PortalUser.make({
  userId: userId(6),
  clientId: zenith.id,
  name: zenith.name,
  email: zenith.email,
});
