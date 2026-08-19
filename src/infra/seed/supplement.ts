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
  /**
   * Present only where the prototype's number cannot be represented.
   *
   * The corporate fixtures carry switchboard landlines — `+254 20 445 3021` —
   * and the domain's `KenyanPhone` accepts mobile prefixes only (7 or 1). That
   * is a genuine limitation of the domain rather than bad data: a firm does
   * hold a landline for a company. Until `KenyanPhone` is widened, the seed
   * records the mobile of the person who instructs, which is the number the
   * domain's field actually means. Noted in ROADMAP §Phase 2.
   */
  readonly phone?: string;
}

export const CLIENT_SUPPLEMENT: Readonly<Record<string, ClientSupplement>> = {
  "CLT-1001": { kraPin: "A004521987Z", onboardedOn: "2024-03-11" },
  "CLT-1002": { kraPin: "A009873214M", onboardedOn: "2025-01-20" },
  "CLT-1003": { kraPin: "A001122334K", onboardedOn: "2025-06-02" },
  "CLT-2001": {
    kraPin: "P051234876T",
    onboardedOn: "2023-09-14",
    phone: "+254722310884",
  },
  "CLT-2002": {
    kraPin: "P059988771B",
    onboardedOn: "2024-11-05",
    phone: "+254733914026",
  },
  "CLT-2003": {
    kraPin: "P052277431H",
    onboardedOn: "2025-02-17",
    phone: "+254711603558",
  },
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

// ── Matters ───────────────────────────────────────────────────────────────

export interface MatterSupplement {
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
    claimValueShillings: 4_200_000,
    accruedOn: "2024-08-30",
    limitationBasis: "contract",
    causeNumber: "MCCC E0412 of 2026",
  },
  "OKL-2026-021": { causeNumber: "MCCR E1188 of 2026" },
  "OKL-2025-098": { causeNumber: "HCSUCC E220 of 2025" },
  "OKL-2026-005": {
    claimValueShillings: 18_400_000,
    accruedOn: "2025-02-11",
    limitationBasis: "contract",
    causeNumber: "HCCOMM E0091 of 2026",
  },
  "OKL-2026-032": { claimValueShillings: 7_650_000 },
  "OKL-2026-011": {
    claimValueShillings: 2_900_000,
    causeNumber: "ELRC E0334 of 2026",
  },
  "OKL-2026-040": {
    claimValueShillings: 11_000_000,
    causeNumber: "ELC E0077 of 2026",
  },
  "OKL-2025-076": { causeNumber: "HCFAM E0512 of 2025" },
};
