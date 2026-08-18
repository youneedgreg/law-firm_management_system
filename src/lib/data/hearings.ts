import type { Hearing } from "../types";

export const HEARINGS: Hearing[] = [
  {
    id: 1,
    caseId: 1,
    caseTitle: "Wanjiku Mwangi v. Nairobi Metro SACCO",
    court: "Milimani Law Courts",
    room: "14",
    date: "19 Aug 2026",
    time: "9:00 AM",
    judge: "Hon. J. Kimani",
    advocate: "Adv. Sarah Wanjiru",
    status: "Confirmed",
  },
  {
    id: 2,
    caseId: 4,
    caseTitle: "General Innovations Ltd v. Zenith Distributors Ltd",
    court: "Milimani Commercial Court",
    room: "6",
    date: "20 Aug 2026",
    time: "11:30 AM",
    judge: "Hon. M. Wafula",
    advocate: "Adv. Brian Kiptoo",
    status: "Confirmed",
  },
  {
    id: 3,
    caseId: 7,
    caseTitle: "Coastal Agro Exports Ltd — Land Boundary Dispute",
    court: "Environment & Land Court, Mombasa",
    room: "2",
    date: "21 Aug 2026",
    time: "10:00 AM",
    judge: "Hon. S. Wafula",
    advocate: "Adv. Brian Kiptoo",
    status: "Confirmed",
  },
  {
    id: 4,
    caseId: 6,
    caseTitle: "Rift Valley Logistics Ltd — Labour Claim",
    court: "Employment & Labour Relations Court",
    room: "3",
    date: "22 Aug 2026",
    time: "2:00 PM",
    judge: "Hon. R. Mutua",
    advocate: "Adv. Faith Achieng",
    status: "Awaiting confirmation",
  },
  {
    id: 5,
    caseId: 2,
    caseTitle: "Republic v. David Odhiambo",
    court: "Milimani Law Courts - Criminal Div.",
    room: "9",
    date: "24 Aug 2026",
    time: "9:30 AM",
    judge: "Hon. P. Otieno",
    advocate: "Adv. Brian Kiptoo",
    status: "Confirmed",
  },
  {
    id: 6,
    caseId: 3,
    caseTitle: "In re Estate of Njeri Kamau",
    court: "Milimani High Court - Family Div.",
    room: "11",
    date: "25 Aug 2026",
    time: "10:30 AM",
    judge: "Hon. L. Chebet",
    advocate: "Adv. Sarah Wanjiru",
    status: "Confirmed",
  },
];

export function getHearing(id: number): Hearing | undefined {
  return HEARINGS.find((hearing) => hearing.id === id);
}

export function nextHearingForCase(caseId: number): Hearing | undefined {
  return HEARINGS.find((hearing) => hearing.caseId === caseId);
}

/** The court-diary strip: one column per sitting day, with its listing count. */
export interface CourtDay {
  label: string;
  date: string;
  count: number;
  isToday: boolean;
}

const WEEKDAY_LABELS = ["Tue", "Wed", "Thu", "Fri", "Sat", "Mon"];

export function courtWeek(): CourtDay[] {
  return HEARINGS.slice(0, 6).map((hearing, index) => ({
    label: WEEKDAY_LABELS[index] ?? "",
    date: hearing.date.split(" ")[0],
    count: HEARINGS.filter((other) => other.date === hearing.date).length,
    isToday: index === 0,
  }));
}
