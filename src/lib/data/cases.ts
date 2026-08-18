import { kes } from "../format";
import type { Case, CaseStatus } from "../types";

/** The seed columns; timeline/notes/hearings/documents/invoices are derived. */
type CaseSeed = Omit<
  Case,
  "timeline" | "notes" | "hearings" | "documents" | "invoices"
>;

const SEED: CaseSeed[] = [
  {
    id: 1,
    number: "OKL-2026-014",
    title: "Wanjiku Mwangi v. Nairobi Metro SACCO",
    type: "Civil",
    practiceArea: "Contract dispute",
    court: "Milimani Law Courts",
    judge: "Hon. J. Kimani",
    opposingCounsel: "Achieng & Partners",
    filed: "14 Feb 2026",
    status: "Hearing Scheduled",
    clientId: 1,
    advocate: "Adv. Sarah Wanjiru",
  },
  {
    id: 2,
    number: "OKL-2026-021",
    title: "Republic v. David Odhiambo",
    type: "Criminal",
    practiceArea: "Criminal defence",
    court: "Milimani Law Courts - Criminal Div.",
    judge: "Hon. P. Otieno",
    opposingCounsel: "ODPP",
    filed: "3 Mar 2026",
    status: "Active",
    clientId: 2,
    advocate: "Adv. Brian Kiptoo",
  },
  {
    id: 3,
    number: "OKL-2025-098",
    title: "In re Estate of Njeri Kamau",
    type: "Probate",
    practiceArea: "Succession",
    court: "Milimani High Court - Family Div.",
    judge: "Hon. L. Chebet",
    opposingCounsel: "N/A",
    filed: "20 Oct 2025",
    status: "Under Review",
    clientId: 3,
    advocate: "Adv. Sarah Wanjiru",
  },
  {
    id: 4,
    number: "OKL-2026-005",
    title: "General Innovations Ltd v. Zenith Distributors Ltd",
    type: "Commercial",
    practiceArea: "Commercial litigation",
    court: "Milimani Commercial Court",
    judge: "Hon. M. Wafula",
    opposingCounsel: "Waweru & Co Advocates",
    filed: "9 Jan 2026",
    status: "Active",
    clientId: 4,
    advocate: "Adv. Brian Kiptoo",
  },
  {
    id: 5,
    number: "OKL-2026-032",
    title: "General Innovations Ltd — KRA Tax Objection",
    type: "Tax",
    practiceArea: "Tax dispute",
    court: "Tax Appeals Tribunal",
    judge: "N/A",
    opposingCounsel: "KRA Legal",
    filed: "2 Apr 2026",
    status: "New",
    clientId: 4,
    advocate: "Adv. Faith Achieng",
  },
  {
    id: 6,
    number: "OKL-2026-011",
    title: "Rift Valley Logistics Ltd — Labour Claim",
    type: "Labour",
    practiceArea: "Employment",
    court: "Employment & Labour Relations Court",
    judge: "Hon. R. Mutua",
    opposingCounsel: "Njoroge Advocates",
    filed: "28 Jan 2026",
    status: "Judgment Pending",
    clientId: 5,
    advocate: "Adv. Faith Achieng",
  },
  {
    id: 7,
    number: "OKL-2026-040",
    title: "Coastal Agro Exports Ltd — Land Boundary Dispute",
    type: "Land",
    practiceArea: "Land law",
    court: "Environment & Land Court, Mombasa",
    judge: "Hon. S. Wafula",
    opposingCounsel: "Coastal Chambers",
    filed: "11 May 2026",
    status: "Hearing Scheduled",
    clientId: 6,
    advocate: "Adv. Brian Kiptoo",
  },
  {
    id: 8,
    number: "OKL-2025-076",
    title: "Grace Njeri — Divorce & Custody",
    type: "Family",
    practiceArea: "Family law",
    court: "Milimani High Court - Family Div.",
    judge: "Hon. L. Chebet",
    opposingCounsel: "Kariuki & Associates",
    filed: "5 Sep 2025",
    status: "Closed",
    clientId: 3,
    advocate: "Adv. Sarah Wanjiru",
  },
];

/** "14 Feb 2026" → "18 Feb 2026" — pleadings land a few days after filing. */
function pleadingsDate(filed: string): string {
  return ["18", ...filed.split(" ").slice(1)].join(" ");
}

export const CASES: Case[] = SEED.map((seed) => ({
  ...seed,
  timeline: [
    { date: seed.filed, text: `Case opened and assigned to ${seed.advocate}` },
    { date: pleadingsDate(seed.filed), text: "Initial pleadings filed" },
    { date: "—", text: "Discovery / document exchange in progress" },
  ],
  notes: [
    "Client prefers email updates over calls.",
    "Awaiting counter-affidavit from opposing counsel.",
  ],
  hearings: [
    { date: "22 Jun 2026", court: seed.court, outcome: "Adjourned" },
    { date: "10 May 2026", court: seed.court, outcome: "Directions given" },
  ],
  documents: [
    "Plaint / Statement of claim.pdf",
    "Client instructions.docx",
    "Bundle of documents.pdf",
  ],
  invoices: [`INV-${3000 + seed.id} — ${kes(120000 + seed.id * 15000)}`],
}));

export const ADVOCATES = [
  "Adv. Sarah Wanjiru",
  "Adv. Brian Kiptoo",
  "Adv. Faith Achieng",
] as const;

/**
 * The advocate whose seat the "Advocate/Lawyer" role sits in. A real
 * deployment would read this from the signed-in user.
 */
export const SIGNED_IN_ADVOCATE = "Adv. Brian Kiptoo";

export function getCase(id: number): Case | undefined {
  return CASES.find((legalCase) => legalCase.id === id);
}

export function casesForClient(clientId: number): Case[] {
  return CASES.filter((legalCase) => legalCase.clientId === clientId);
}

export function caseStatusCounts(): { label: CaseStatus; count: number }[] {
  const counts = new Map<CaseStatus, number>();
  for (const legalCase of CASES) {
    counts.set(legalCase.status, (counts.get(legalCase.status) ?? 0) + 1);
  }
  return [...counts].map(([label, count]) => ({ label, count }));
}

export function advocateWorkload(): { name: string; count: number }[] {
  return ADVOCATES.map((name) => ({
    name,
    count: CASES.filter((c) => c.advocate === name && c.status !== "Closed")
      .length,
  }));
}

export function practiceAreas(): string[] {
  return [...new Set(CASES.map((legalCase) => legalCase.practiceArea))];
}

/** The courts the firm already appears before — the options a new matter picks
 *  from, rather than a free-text field that would fragment the same registry
 *  across a dozen spellings. */
export function courts(): string[] {
  return [...new Set(CASES.map((legalCase) => legalCase.court))].sort();
}
