import type { FirmDocument } from "../types";

type DocumentSeed = Omit<FirmDocument, "versions" | "tags">;

const SEED: DocumentSeed[] = [
  {
    id: 1,
    name: "Plaint - Wanjiku v Nairobi Metro SACCO.pdf",
    category: "Pleadings",
    case: "OKL-2026-014",
    version: 2,
    date: "16 Feb 2026",
    sigStatus: "Signed",
  },
  {
    id: 2,
    name: "Master Services Agreement - Zenith.docx",
    category: "Contracts",
    case: "OKL-2026-005",
    version: 3,
    date: "12 Jan 2026",
    sigStatus: "Pending signature",
  },
  {
    id: 3,
    name: "Affidavit of Service - Odhiambo.pdf",
    category: "Affidavits",
    case: "OKL-2026-021",
    version: 1,
    date: "6 Mar 2026",
    sigStatus: "Signed",
  },
  {
    id: 4,
    name: "Witness Statement - J. Mwangi.pdf",
    category: "Witness Statements",
    case: "OKL-2026-014",
    version: 1,
    date: "2 Mar 2026",
    sigStatus: "Signed",
  },
  {
    id: 5,
    name: "Judgment - Estate of Njeri Kamau.pdf",
    category: "Judgments",
    case: "OKL-2025-098",
    version: 1,
    date: "1 Jun 2026",
    sigStatus: "Final",
  },
  {
    id: 6,
    name: "Correspondence - KRA Objection Letter.pdf",
    category: "Correspondence",
    case: "OKL-2026-032",
    version: 1,
    date: "4 Apr 2026",
    sigStatus: "Signed",
  },
  {
    id: 7,
    name: "Boundary Survey Report.pdf",
    category: "Correspondence",
    case: "OKL-2026-040",
    version: 1,
    date: "14 May 2026",
    sigStatus: "Signed",
  },
  {
    id: 8,
    name: "Employment Contract - Rift Valley.pdf",
    category: "Contracts",
    case: "OKL-2026-011",
    version: 2,
    date: "30 Jan 2026",
    sigStatus: "Pending signature",
  },
];

export const DOCUMENTS: FirmDocument[] = SEED.map((seed) => ({
  ...seed,
  versions: [
    { n: seed.version, date: seed.date, by: "Adv. Sarah Wanjiru" },
    { n: 1, date: "earlier draft", by: "Legal Assistant" },
  ],
  tags: [seed.category, "Client-facing"],
}));

export function getDocument(id: number): FirmDocument | undefined {
  return DOCUMENTS.find((document) => document.id === id);
}

/** Documents attached to any of the given case numbers. */
export function documentsForCaseNumbers(caseNumbers: string[]): FirmDocument[] {
  return DOCUMENTS.filter((document) => caseNumbers.includes(document.case));
}
