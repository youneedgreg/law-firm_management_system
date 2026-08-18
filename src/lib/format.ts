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
  Issued: "tag tag-neutral",
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

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * A date field's value ("2026-08-19") in the house format ("19 Aug 2026"), the
 * one every seeded record is written in. Parsed by hand rather than through
 * `new Date()`, which would read the value as UTC and can shift the day.
 */
export function displayDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** Today, in the same format. */
export function today(): string {
  const now = new Date();
  return `${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
}

/** A time field's value ("14:30") as the diary writes it ("2:30 PM"). */
export function displayTime(value: string): string {
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return value;
  const suffix = hours < 12 ? "AM" : "PM";
  const clockHour = hours % 12 === 0 ? 12 : hours % 12;
  return `${clockHour}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

/** Billable hours between two time fields, to the quarter hour. */
export function hoursBetween(start: string, end: string): number {
  const toMinutes = (value: string) => {
    const [hours, minutes] = value.split(":").map(Number);
    return Number.isFinite(hours) && Number.isFinite(minutes)
      ? hours * 60 + minutes
      : Number.NaN;
  };
  const span = toMinutes(end) - toMinutes(start);
  if (!Number.isFinite(span) || span <= 0) return 0;
  return Math.round((span / 60) * 4) / 4;
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
