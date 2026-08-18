import type {
  CaseStatus,
  InvoiceStatus,
  Priority,
  SignatureStatus,
  TagClass,
} from "./types";

/** The firm bills in Kenyan shillings; the spec lists KES as default currency. */
export function kes(amount: number): string {
  return `KES ${amount.toLocaleString("en-KE")}`;
}

const CASE_STATUS_TAG: Record<CaseStatus, TagClass> = {
  New: "tag tag-neutral",
  Active: "tag tag-accent",
  "Hearing Scheduled": "tag tag-outline",
  "Under Review": "tag tag-outline",
  "Judgment Pending": "tag tag-outline",
  Closed: "tag tag-neutral",
  Appealed: "tag tag-accent-2",
};

export function caseStatusTag(status: CaseStatus): TagClass {
  return CASE_STATUS_TAG[status];
}

const INVOICE_STATUS_TAG: Record<InvoiceStatus, TagClass> = {
  Paid: "tag tag-accent",
  Overdue: "tag tag-accent-2",
  "Partially Paid": "tag tag-outline",
};

export function invoiceStatusTag(status: InvoiceStatus): TagClass {
  return INVOICE_STATUS_TAG[status];
}

const PRIORITY_TAG: Record<Priority, TagClass> = {
  High: "tag tag-accent-2",
  Medium: "tag tag-outline",
  Low: "tag tag-neutral",
};

export function priorityTag(priority: Priority): TagClass {
  return PRIORITY_TAG[priority];
}

export function signatureTag(status: SignatureStatus): TagClass {
  return status === "Pending signature" ? "tag tag-outline" : "tag tag-accent";
}

export function billableTag(billable: boolean): TagClass {
  return billable ? "tag tag-accent" : "tag tag-neutral";
}

/** Initials for the avatar chip, e.g. "Legal Assistant/Paralegal" → "LA". */
export function initials(name: string): string {
  return name
    .split(/[ /]/)
    .filter(Boolean)
    .map((word) => word[0])
    .slice(0, 2)
    .join("");
}
