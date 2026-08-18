import type { Client, ClientContact, Engagement } from "../types";

export const CLIENTS: Client[] = [
  {
    id: 1,
    number: "CLT-1001",
    name: "Wanjiku Mwangi",
    type: "individual",
    contact: "Wanjiku Mwangi",
    email: "wanjiku.m@gmail.com",
    phone: "+254 722 445 109",
    activeCases: 1,
    conflictStatus: "No conflict found",
  },
  {
    id: 2,
    number: "CLT-1002",
    name: "David Odhiambo",
    type: "individual",
    contact: "David Odhiambo",
    email: "d.odhiambo@yahoo.com",
    phone: "+254 733 208 771",
    activeCases: 1,
    conflictStatus: "No conflict found",
  },
  {
    id: 3,
    number: "CLT-1003",
    name: "Grace Njeri",
    type: "individual",
    contact: "Grace Njeri",
    email: "grace.njeri@outlook.com",
    phone: "+254 711 990 232",
    activeCases: 0,
    conflictStatus: "No conflict found",
  },
  {
    id: 4,
    number: "CLT-2001",
    name: "General Innovations Ltd",
    type: "corporate",
    contact: "Peter Kamau (CFO)",
    email: "pkamau@geninnovations.co.ke",
    phone: "+254 20 445 3021",
    activeCases: 2,
    conflictStatus: "Cleared 12 Jun 2026",
  },
  {
    id: 5,
    number: "CLT-2002",
    name: "Rift Valley Logistics Ltd",
    type: "corporate",
    contact: "Amina Yusuf (Legal Officer)",
    email: "amina@riftlogistics.co.ke",
    phone: "+254 20 221 8890",
    activeCases: 1,
    conflictStatus: "No conflict found",
  },
  {
    id: 6,
    number: "CLT-2003",
    name: "Coastal Agro Exports Ltd",
    type: "corporate",
    contact: "John Mwakio (MD)",
    email: "jmwakio@coastalagro.co.ke",
    phone: "+254 41 220 7743",
    activeCases: 1,
    conflictStatus: "No conflict found",
  },
];

export function getClient(id: number): Client | undefined {
  return CLIENTS.find((client) => client.id === id);
}

export function clientTypeLabel(client: Client, long = false): string {
  const noun = long ? " client" : "";
  return (client.type === "individual" ? "Individual" : "Corporate") + noun;
}

export function engagementHistory(): Engagement[] {
  return [
    { date: "2024", text: "Engaged for first matter" },
    { date: "2025", text: "Retainer agreement renewed" },
    { date: "2026", text: "Active matter opened" },
  ];
}

export function clientContacts(client: Client): ClientContact[] {
  return [{ name: client.contact, role: "Primary contact" }];
}
