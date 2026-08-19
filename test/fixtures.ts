import { Schema } from "effect";
import type * as Matter from "@/domain/case/case";
import type * as Client from "@/domain/client/client";
import type * as Firm from "@/domain/firm/advocate";
import {
  AdvocateId,
  CaseId,
  CaseNumber,
  ClientId,
  KenyanPhone,
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
