import { casesForClient } from "./cases";
import { CLIENTS } from "./clients";
import { documentsForCaseNumbers } from "./documents";
import { COMMUNICATIONS } from "./firm";
import { invoicesForClient } from "./billing";
import type { Client, PortalMessage } from "../types";

/**
 * The portal is scoped to one signed-in client. Until there is real
 * authentication, General Innovations Ltd stands in for that session — the
 * corporate client with the fullest file (two matters, several invoices).
 */
const PORTAL_CLIENT_NUMBER = "CLT-2001";

const portalClient = CLIENTS.find(
  (client) => client.number === PORTAL_CLIENT_NUMBER,
);

// Looked up by client number rather than array position: the seed data is
// reordered often enough that an index would silently sign in the wrong client.
if (!portalClient) {
  throw new Error(
    `Portal client ${PORTAL_CLIENT_NUMBER} is missing from CLIENTS`,
  );
}

export const PORTAL_CLIENT: Client = portalClient;

export function portalCases() {
  return casesForClient(PORTAL_CLIENT.id);
}

export function portalDocuments() {
  return documentsForCaseNumbers(portalCases().map((c) => c.number));
}

export function portalInvoices() {
  return invoicesForClient(PORTAL_CLIENT.name);
}

export function portalMessages(): PortalMessage[] {
  const logged = COMMUNICATIONS.filter(
    (entry) => entry.with === PORTAL_CLIENT.name,
  );
  if (logged.length > 0) {
    return logged.map((entry) => ({
      from: entry.channel,
      date: entry.date,
      text: entry.summary,
    }));
  }
  return [
    {
      from: "Adv. Brian Kiptoo",
      date: "16 Aug 2026",
      text: "Hi Peter, sharing the latest invoice for your review.",
    },
    {
      from: PORTAL_CLIENT.contact,
      date: "16 Aug 2026",
      text: "Received, will process payment this week.",
    },
  ];
}

export const PORTAL_NAV = [
  { href: "/portal", label: "Overview" },
  { href: "/portal/cases", label: "My Cases" },
  { href: "/portal/documents", label: "Documents" },
  { href: "/portal/invoices", label: "Invoices" },
  { href: "/portal/messages", label: "Messages" },
] as const;
