import * as Court from "../../domain/court/court";

/**
 * Everything the wireframe never recorded, stated once and out loud.
 *
 * The prototype's fixtures were written to fill a screen, so they carry what a
 * screen shows: a client's name and a court's name as free text. The domain
 * needs a KRA PIN, an onboarding date, and a court that knows its own
 * jurisdiction. That gap has to be closed somewhere, and the choice is between
 * closing it in one reviewable table or scattering plausible-looking defaults
 * through an adapter where nobody will find them again.
 *
 * This is that table. Everything here is **supplied**, not derived — an
 * assumption a reader can disagree with, rather than a fact the import
 * discovered.
 */

/**
 * The day the seeded dataset is "as at".
 *
 * Fixed rather than `new Date()`, because half the fixtures describe a state
 * relative to now — an invoice is "Overdue", a matter is "Hearing Scheduled" —
 * and a seed whose meaning drifts with the wall clock produces a demo that is
 * subtly different every morning and tests that fail in November.
 */
export const AS_AT = new Date("2026-08-19T00:00:00.000Z");

// ── Clients ───────────────────────────────────────────────────────────────

export interface ClientSupplement {
  /** KRA issues `A` PINs to individuals and `P` PINs to entities. */
  readonly kraPin: string;
  readonly onboardedOn: string;
}

/**
 * The corporate fixtures' switchboard landlines are used as written now.
 *
 * They were substituted with mobiles when `KenyanPhone` accepted mobile ranges
 * only — the seed was falsifying data to satisfy a type that was too narrow.
 * The type was the thing that was wrong, and widening it (and the matching
 * constraint, migration 0004) removed the need for the substitution entirely.
 */
export const CLIENT_SUPPLEMENT: Readonly<Record<string, ClientSupplement>> = {
  "CLT-1001": { kraPin: "A004521987Z", onboardedOn: "2024-03-11" },
  "CLT-1002": { kraPin: "A009873214M", onboardedOn: "2025-01-20" },
  "CLT-1003": { kraPin: "A001122334K", onboardedOn: "2025-06-02" },
  "CLT-2001": { kraPin: "P051234876T", onboardedOn: "2023-09-14" },
  "CLT-2002": { kraPin: "P059988771B", onboardedOn: "2024-11-05" },
  "CLT-2003": { kraPin: "P052277431H", onboardedOn: "2025-02-17" },
};

// ── Staff ─────────────────────────────────────────────────────────────────

/**
 * The prototype calls the role "Paralegal"; the domain and the `staff_role`
 * enum call it "Legal Assistant". One name for one thing.
 */
export const ROLE_ALIASES: Readonly<Record<string, string>> = {
  Paralegal: "Legal Assistant",
  "Advocate/Lawyer": "Advocate",
  "Legal Assistant/Paralegal": "Legal Assistant",
};

export interface CertificateSupplement {
  readonly number: string;
  readonly year: number;
  readonly admittedOn: string;
}

/**
 * Practising certificates, which only advocates hold.
 *
 * Absent for the paralegal, the finance officer and the receptionist — not as
 * an oversight but as the point of the field: `mayAppearInCourt` is false for
 * them, and it should be false because they hold no certificate rather than
 * because someone remembered to set a flag.
 */
export const CERTIFICATES: Readonly<Record<string, CertificateSupplement>> = {
  "Adv. Sarah Wanjiru": {
    number: "PC/2026/0041",
    year: 2026,
    admittedOn: "2012-11-30",
  },
  "Adv. Brian Kiptoo": {
    number: "PC/2026/0118",
    year: 2026,
    admittedOn: "2016-05-20",
  },
  "Adv. Faith Achieng": {
    number: "PC/2026/0203",
    year: 2026,
    admittedOn: "2019-07-12",
  },
};

// ── Courts ────────────────────────────────────────────────────────────────

/**
 * The prototype's free-text court names, resolved to real courts.
 *
 * This is the mapping the whole exercise is about. `"Milimani Commercial
 * Court"` cannot answer whether it may hear a KES 18,000,000 claim; a
 * `HighCourt` in the Commercial and Tax division can, and a `MagistratesCourt`
 * carrying its rank can say no and cite the section.
 *
 * A name absent from this table is a **failure**, never a default. Guessing
 * would put a matter in a court that cannot hear it and print a confident
 * jurisdiction check next to it.
 *
 * `null` is a deliberate entry, not a missing one: the Tax Appeals Tribunal is
 * a tribunal constituted under the Tax Appeals Tribunal Act, not a court in the
 * Article 162 hierarchy. `Case.court` is optional precisely so a matter before
 * a tribunal can be recorded without pretending it is before a court.
 */
export const COURTS: Readonly<Record<string, Court.Court | null>> = {
  "Milimani Law Courts": Court.MagistratesCourt.make({
    station: "Milimani",
    rank: "Chief Magistrate",
  }),
  "Milimani Law Courts - Criminal Div.": Court.MagistratesCourt.make({
    station: "Milimani",
    rank: "Principal Magistrate",
  }),
  "Milimani High Court - Family Div.": Court.HighCourt.make({
    station: "Milimani",
    division: "Family",
  }),
  "Milimani Commercial Court": Court.HighCourt.make({
    station: "Milimani",
    division: "Commercial and Tax",
  }),
  "Employment & Labour Relations Court":
    Court.EmploymentAndLabourRelationsCourt.make({ station: "Nairobi" }),
  "Environment & Land Court, Mombasa": Court.EnvironmentAndLandCourt.make({
    station: "Mombasa",
  }),
  "Tax Appeals Tribunal": null,
};

// ── Payments ──────────────────────────────────────────────────────────────

/**
 * M-Pesa confirmation codes, for the fee notes the prototype says were paid
 * that way.
 *
 * The prototype records a payment *method* per invoice and no reference at all,
 * so the seed was writing `INV-3001/1` into the reference column for every
 * payment regardless of method. For a cheque that is harmless if useless. For
 * M-Pesa it was a falsehood of exactly the kind `KenyanPhone` was making in
 * Phase 2: a value invented to satisfy a field, sitting in the column a
 * reconciliation would read.
 *
 * Now the domain refuses an M-Pesa payment with no confirmation code, so the
 * codes are supplied here, out loud, where a reader can see that they were made
 * up rather than discovering it from a statement that will never match. They
 * are format-valid and fictional; no real transaction has these codes.
 *
 * Required rather than defaulted: an M-Pesa fee note with no entry fails the
 * import. A default would put the seed straight back where it was.
 */
export const MPESA_CONFIRMATIONS: Readonly<Record<string, string>> = {
  "INV-3001": "QGH7XYZ12A",
};

// ── Court dates ───────────────────────────────────────────────────────────

/**
 * What each listed hearing is *for*.
 *
 * The prototype records a `status` — "Confirmed" or "Tentative" — which is
 * about whether the listing is firm, not about what the court will do on the
 * day. `HearingKind` is the second question, and a mention, a hearing and a
 * ruling are different events with different preparation behind them.
 *
 * Supplied, and required: a hearing with no entry fails the import rather than
 * defaulting to "Hearing", which would say every date in the diary is a full
 * hearing and make the diary useless for planning a week.
 */
export const HEARING_KINDS_BY_ID: Readonly<Record<number, string>> = {
  1: "Hearing",
  2: "Mention",
  3: "Mention",
  4: "Directions",
  5: "Ruling",
  6: "Hearing",
};

// ── Documents ─────────────────────────────────────────────────────────────

/**
 * Which documents the prototype says are on the court record.
 *
 * The prototype records a signature status and a version count, and says
 * nothing about filing — but `filedWithCourt` is the flag that makes a document
 * *fixed*, so it cannot be defaulted to `false` for everything without quietly
 * asserting that the firm has never filed anything.
 *
 * Supplied here, and only for the documents that plausibly went to court: a
 * plaint and an affidavit of service are filed; a master services agreement and
 * an attendance note are not.
 */
export const FILED_WITH_COURT: ReadonlySet<number> = new Set([1, 3, 5]);

/**
 * The prototype's signature vocabulary, mapped onto the domain's.
 *
 * Two of the three prototype values are not domain values. "Pending signature"
 * is plainly `Awaiting signature`. "Final" is the interesting one: it is what
 * the prototype says about a *judgment*, and a judgment is not a document the
 * firm signs at all — the court issued it. `Not required` is the truthful
 * answer, and it is a decision rather than a rename, which is why it is
 * written down here instead of buried in a `??`.
 *
 * A status not in this table is refused by the seed. The alternative — falling
 * back to `Not required` — would silently mark a contract as needing no
 * signature.
 */
export const SIGNATURE_STATUSES_BY_PROTOTYPE: ReadonlyMap<string, string> =
  new Map([
    ["Signed", "Signed"],
    ["Pending signature", "Awaiting signature"],
    ["Final", "Not required"],
  ]);

// ── Work ──────────────────────────────────────────────────────────────────

/**
 * The prototype's task statuses, mapped onto the domain's.
 *
 * `Scheduled` is the interesting one, and it is dropped rather than renamed.
 * It was never a state of the *work* — it was the presence of a date, and
 * every task has a due date. The one task carrying it is "Attend hearing",
 * which is a court date; the diary owns those, and the task is the preparation.
 * `In progress` is the truthful reading: somebody has it, and it is not done.
 *
 * A status not in this table stops the import rather than defaulting, because
 * defaulting to `Not started` would silently un-do work somebody had begun.
 */
export const TASK_STATUSES_BY_PROTOTYPE: ReadonlyMap<string, string> = new Map([
  ["Not started", "Not started"],
  ["In progress", "In progress"],
  ["Scheduled", "In progress"],
  ["Done", "Done"],
]);

/**
 * Who the prototype's task assignees actually are.
 *
 * **The prototype's own data is inconsistent, and this is where that shows.**
 * `TASKS` assigns "File documents at registry" to `"Clerk - James"`, and
 * `STAFF` in `lib/data/firm.ts` — the same prototype's own staff list — does
 * not contain anybody by that name. The task list and the staff list disagree.
 *
 * That is worth stating rather than smoothing over, because the domain has a
 * rule about exactly this: work is assigned to a named person on the staff
 * list, and a task assigned to somebody who is not there is a task nobody is
 * doing while looking, in every list, as though somebody is.
 *
 * The registry filing is a legal assistant's job, so it goes to Mercy — a
 * decision, recorded here, rather than a `?? someone`. Every other name maps to
 * itself; an assignee absent from both this table and the staff list stops the
 * import.
 */
export const TASK_ASSIGNEES: ReadonlyMap<string, string> = new Map([
  ["Clerk - James", "Legal Assistant - Mercy"],
]);

// ── Correspondence ────────────────────────────────────────────────────────

/**
 * A short thread per client, supplied outright.
 *
 * **The prototype has no messages.** It has `COMMUNICATIONS` — a contact log of
 * calls, meetings, WhatsApp and email *summaries* — and that is a different
 * record: "Discussed plea strategy" on a phone call is a note somebody made
 * about a conversation, not something anybody typed to a client. Importing it
 * as correspondence would put words in the firm's mouth and, worse, would make
 * the audit trail say those words were *sent*. The contact log belongs to the
 * communications module; this is the client thread, and it starts empty unless
 * something is written here.
 *
 * So these are invented, and their shape is chosen to make the one report that
 * matters demonstrable:
 *
 * - **Wanjiku is waiting.** She asked, the firm read it, and nothing was said
 *   since. That is the case every unread badge reports as clear.
 * - **General Innovations is not.** They asked and were answered, so a
 *   `waiting()` that returned everything would be visibly wrong.
 *
 * `sentAt` is expressed as days before `AS_AT` rather than as a fixed date, so
 * the demo shows a plausible "waiting 3 days" however long after the fixtures
 * were written it is run.
 */
export const SEEDED_THREAD: readonly {
  readonly clientNumber: string;
  readonly matterNumber?: string;
  readonly from: "client" | "firm";
  readonly daysAgo: number;
  readonly read: boolean;
  readonly body: string;
}[] = [
  {
    clientNumber: "CLT-1001",
    matterNumber: "OKL-2026-014",
    from: "firm",
    daysAgo: 9,
    read: true,
    body:
      "Good afternoon. The plaint and verifying affidavit have been filed at " +
      "Milimani. I will confirm the hearing date as soon as the registry " +
      "issues it.",
  },
  {
    clientNumber: "CLT-1001",
    matterNumber: "OKL-2026-014",
    from: "client",
    daysAgo: 4,
    // Read, and not answered. The point of the whole module.
    read: true,
    body: "Thank you. Has the hearing date come through yet?",
  },
  {
    clientNumber: "CLT-1001",
    from: "client",
    daysAgo: 2,
    read: false,
    body: "Sorry to chase — is there any news? My employer needs the date.",
  },
  {
    clientNumber: "CLT-2001",
    from: "client",
    daysAgo: 6,
    read: true,
    body: "Could you resend the fee note for last month? I cannot find it.",
  },
  {
    clientNumber: "CLT-2001",
    from: "firm",
    daysAgo: 5,
    read: false,
    body:
      "Attached again — INV-3002. Let me know if you would like it broken " +
      "down by activity.",
  },
];

// ── The firm's own records ────────────────────────────────────────────────

/**
 * Which way each logged conversation went.
 *
 * The prototype records a channel, a client and a summary, and not whether the
 * firm rang them or they rang the firm — which is the first question anybody
 * puts to a contact log. Defaulting to `Outgoing` would claim the firm
 * initiated every conversation it has ever had, which is both untrue and
 * flattering, so each entry is decided here and an unlisted one stops the
 * import.
 *
 * Read against the summaries: sending a confirmation and sharing an invoice are
 * things the firm did; a site-visit debrief and a plea-strategy discussion are
 * meetings, recorded from the firm's side but initiated by the matter rather
 * than by either party — those are marked `Outgoing` only where the summary
 * says the firm sent something.
 */
export const CONTACT_DIRECTIONS: ReadonlyMap<number, string> = new Map([
  [1, "Outgoing"],
  [2, "Outgoing"],
  [3, "Incoming"],
  [4, "Incoming"],
  [5, "Outgoing"],
  [6, "Incoming"],
]);

/**
 * Two conversations dated back, so the report the log exists for has something
 * to show.
 *
 * The prototype's six log entries name six different clients — the firm's
 * entire client list — and all fall within a week of each other. Imported as
 * they stand, every client counts as recently contacted and `neglected` returns
 * nothing at all.
 *
 * That is a *correct* answer and a useless demonstration: the one question a
 * contact log exists to answer would be invisible, exactly as the precedent
 * bank's staleness report would be if every entry had a review date. So two
 * entries are moved back, marked here as supplied rather than adapted.
 *
 * The choice of which is not arbitrary. Coastal Agro's site-visit debrief and
 * Grace Njeri's ID request are both one-off administrative exchanges — the kind
 * a firm has once and then does not follow up, which is precisely how a client
 * goes quiet without anybody deciding to neglect them.
 */
export const CONTACT_BACKDATED: ReadonlyMap<number, string> = new Map([
  [4, "14 Apr 2026"],
  [6, "12 May 2026"],
]);

/**
 * Real dates for the knowledge base, whose own are labels.
 *
 * The prototype writes `"Updated Jan 2026"` — a string for a screen, not a
 * date — and the domain needs two: when the entry was filed, and when somebody
 * last checked it against current law.
 *
 * **`reviewed` is deliberately absent for some.** A precedent nobody has
 * verified since it went in is exactly the one to be careful of, and supplying
 * a review date for everything would make the staleness report empty and the
 * whole point of the module invisible. The Land Registration checklist and the
 * Court of Appeal digest are the two nobody has looked at.
 */
export const PRECEDENT_DATES: ReadonlyMap<
  number,
  {
    readonly added: string;
    readonly reviewed?: string;
    readonly addedBy: string;
    readonly location: string;
    readonly note?: string;
  }
> = new Map([
  [
    1,
    {
      added: "12 Mar 2021",
      reviewed: "14 Jan 2026",
      addedBy: "Adv. Sarah Wanjiru",
      location: "Shared drive · /precedents/employment",
      note: "Annotated against the 2024 amendments.",
    },
  ],
  [
    2,
    {
      added: "3 Feb 2022",
      reviewed: "9 Mar 2026",
      addedBy: "Adv. Brian Kiptoo",
      location: "Shared drive · /templates/civil-procedure",
    },
  ],
  [
    3,
    {
      added: "18 Jun 2019",
      addedBy: "Adv. Sarah Wanjiru",
      location: "Lever-arch, second shelf",
      note: "Predates the 2023 regulations — check before relying on it.",
    },
  ],
  [
    4,
    {
      added: "2 Aug 2023",
      addedBy: "Adv. Brian Kiptoo",
      location: "Shared drive · /digests/court-of-appeal",
    },
  ],
  [
    5,
    {
      added: "7 Apr 2024",
      reviewed: "4 Apr 2026",
      addedBy: "Adv. Faith Achieng",
      location: "Shared drive · /precedents/kra",
      note: "Includes the notice of objection template.",
    },
  ],
]);

// ── Recorded time ─────────────────────────────────────────────────────────

/**
 * Hourly rates, by fee-earner.
 *
 * The prototype records who did the work and for how long, and no rate at all —
 * a screen showing "2.5 hours" does not need one. A `TimeEntry` does, because
 * the whole point of recording time is that a fee note can be built from it,
 * and a rate of zero would produce a bill for nothing.
 *
 * Supplied, like everything else here, and plausible for Nairobi in 2026 rather
 * than researched: a partner above a senior advocate above a legal assistant.
 * An entry for somebody absent from this table fails the import, which is what
 * stops a missing rate silently becoming free work.
 */
export const HOURLY_RATES: Readonly<Record<string, number>> = {
  "Adv. Sarah Wanjiru": 25_000,
  "Adv. Brian Kiptoo": 20_000,
  "Adv. Faith Achieng": 20_000,
  "Legal Assistant - Mercy": 8_000,
  "Finance - Peter": 6_000,
  "Reception - Ann": 4_000,
};

/**
 * A narrative per prototype entry.
 *
 * `TimeEntry.narrative` is `NonEmptyTrimmedString` because it is the thing a
 * client reads when a bill is challenged — "Drafting" alone is not a defensible
 * description of three hours. The prototype has only the activity, so these are
 * written here rather than derived from it, and are marked as invented by
 * living in this file.
 */
export const TIME_NARRATIVES: Readonly<Record<number, string>> = {
  1: "Drafting the plaint and verifying affidavit",
  2: "Attending court for directions",
  3: "Researching the pecuniary jurisdiction point",
  4: "File housekeeping and correspondence filing",
  5: "Consultation with the client on settlement terms",
  6: "Drafting the list of documents",
};

// ── Matters ───────────────────────────────────────────────────────────────

export interface MatterSupplement {
  /**
   * When the firm opened the file, which is not when it was filed in court.
   *
   * The prototype records one date per matter — the filing date — so
   * `openedOn` and `filedOn` were seeded equal, which said every matter was
   * filed the day it walked in the door. Intake, conflict screening and
   * drafting all sit in that gap, and `filed_after_opened` is the constraint
   * that assumes it exists.
   *
   * Supplied, like everything else here. Required rather than optional: a
   * matter with no intake date is a fixture nobody has looked at, and the
   * import says so rather than falling back to the filing date again.
   */
  readonly openedOn: string;
  /**
   * What the matter is worth, where it has a pecuniary value.
   *
   * Absent for the criminal defence and the divorce — which is a different
   * thing from a claim worth nothing, and the reason `claimValueCents` is
   * optional. `canFileIn` refuses a magistrates' court with no value recorded
   * rather than assuming it is within the limit.
   */
  readonly claimValueShillings?: number;
  readonly accruedOn?: string;
  readonly limitationBasis?: "contract" | "tort" | "defamation";
  readonly causeNumber?: string;
}

export const MATTER_SUPPLEMENT: Readonly<Record<string, MatterSupplement>> = {
  "OKL-2026-014": {
    openedOn: "2026-01-19",
    claimValueShillings: 4_200_000,
    accruedOn: "2024-08-30",
    limitationBasis: "contract",
    causeNumber: "MCCC E0412 of 2026",
  },
  // A criminal defence is instructed and filed within days; the gap is short.
  "OKL-2026-021": { openedOn: "2026-02-27", causeNumber: "MCCR E1188 of 2026" },
  "OKL-2025-098": {
    openedOn: "2025-09-08",
    causeNumber: "HCSUCC E220 of 2025",
  },
  "OKL-2026-005": {
    openedOn: "2025-11-24",
    claimValueShillings: 18_400_000,
    accruedOn: "2025-02-11",
    limitationBasis: "contract",
    causeNumber: "HCCOMM E0091 of 2026",
  },
  "OKL-2026-032": { openedOn: "2026-03-16", claimValueShillings: 7_650_000 },
  "OKL-2026-011": {
    openedOn: "2025-12-15",
    claimValueShillings: 2_900_000,
    causeNumber: "ELRC E0334 of 2026",
  },
  "OKL-2026-040": {
    openedOn: "2026-04-13",
    claimValueShillings: 11_000_000,
    causeNumber: "ELC E0077 of 2026",
  },
  "OKL-2025-076": {
    openedOn: "2025-08-11",
    causeNumber: "HCFAM E0512 of 2025",
  },
};

/**
 * What the prototype's appointments were actually about.
 *
 * The mock recorded a free-text "With" — `"Peter Kamau (Gen. Innovations)"`,
 * `"Managing Partner"` — which is a person's name typed into a box and not a
 * reference to anybody. The diary now holds a real advocate, and optionally a
 * real client and matter, so each prototype row needs saying properly.
 *
 * `client` and `case` are `null` where there genuinely is none: an internal
 * strategy meeting is about a matter, a performance review is about neither.
 *
 * The dates are the prototype's own, and they cluster around `AS_AT`. Two of
 * the five are already behind it, which is correct rather than unfortunate —
 * a diary is mostly past, and a seed that pushed everything into the future to
 * make the screen look busy would be describing a firm that has never held a
 * meeting.
 */
export interface AppointmentSupplement {
  readonly type:
    "Client consultation" | "Internal meeting" | "Site visit" | "Call";
  readonly advocate: string;
  readonly client: string | null;
  readonly case: string | null;
  readonly minutes: number;
  readonly location: string | null;
  /** Restated where the prototype's title was a label rather than a subject. */
  readonly title: string | null;
}

/**
 * Keyed by the prototype's integer id.
 *
 * **Appointment 3 is deliberately absent.** The prototype typed a court
 * appearance at Milimani as an appointment, with `"Court appearance"` as its
 * type — and that is a hearing. It has a court, a cause number and an outcome
 * somebody must record, none of which an appointment can hold, and the court
 * diary already carries the firm's real listings. Importing it here would put a
 * court date in the one place the calendar cannot see it, which is the failure
 * this module was built to prevent. The adapter refuses it by name rather than
 * skipping it silently.
 */
export const APPOINTMENT_SUPPLEMENT: Readonly<
  Record<number, AppointmentSupplement>
> = {
  1: {
    type: "Client consultation",
    advocate: "Adv. Sarah Wanjiru",
    client: "General Innovations Ltd",
    case: null,
    minutes: 60,
    location: "Boardroom",
    title: "New client consultation",
  },
  2: {
    type: "Internal meeting",
    advocate: "Adv. Sarah Wanjiru",
    client: null,
    case: "OKL-2026-014",
    minutes: 90,
    location: "Boardroom",
    title: "Case strategy — Wanjiku v. Nairobi Metro SACCO",
  },
  4: {
    type: "Client consultation",
    advocate: "Adv. Brian Kiptoo",
    client: "Grace Njeri",
    case: null,
    minutes: 60,
    location: null,
    title: "Consultation — divorce matter",
  },
  5: {
    type: "Internal meeting",
    advocate: "Adv. Sarah Wanjiru",
    client: null,
    case: null,
    minutes: 45,
    location: "Managing Partner's office",
    title: "Partner performance review",
  },
};

/** The prototype id this seed refuses, and why, so the message can say it. */
export const COURT_APPEARANCE_APPOINTMENT = 3;

/** Times the prototype wrote as `9:00 AM`, in 24-hour UTC. */
export const APPOINTMENT_TIMES: Readonly<Record<number, string>> = {
  1: "09:00",
  2: "15:00",
  4: "13:00",
  5: "10:00",
};
