import type { InvoiceStatus as FeeNoteStatus } from "@/domain/billing/invoice";
import type { SignatureStatus } from "@/domain/document/document";
import type { Priority } from "@/domain/work/task";
import type { CaseStatus, InvoiceStatus, TagClass } from "./types";

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

/**
 * The same idea for the domain's own invoice statuses.
 *
 * Two functions because there are, for now, two vocabularies: the prototype's
 * (`Issued`) and the domain's, which is derived from an invoice's lines and
 * payments and includes `Overpaid` — a state the prototype could not represent
 * and a firm genuinely reaches when a client pays twice. The screens still on
 * seed data use the first; anything reading `BillingService` uses this. They
 * converge in Phase 7 when the billing module migrates, and the prototype's
 * goes with it.
 */
const FEE_NOTE_STATUS_TAG: Record<FeeNoteStatus, TagClass> = {
  Unpaid: "tag tag-neutral",
  "Partially Paid": "tag tag-outline",
  Paid: "tag tag-accent",
  Overdue: "tag tag-accent-2",
  Overpaid: "tag tag-accent-2",
};

export function feeNoteStatusTag(status: FeeNoteStatus): TagClass {
  return FEE_NOTE_STATUS_TAG[status];
}

/**
 * Takes the *domain* priority, like `signatureTag` takes the domain's
 * signature status. The three values happen to be spelled the same as the
 * prototype's, which is exactly why it is worth pointing at the domain
 * deliberately: a silent structural match is one that stops matching without
 * anything failing.
 */
const PRIORITY_TAG: Record<Priority, TagClass> = {
  High: "tag tag-accent-2",
  Medium: "tag tag-outline",
  Low: "tag tag-neutral",
};

export function priorityTag(priority: Priority): TagClass {
  return PRIORITY_TAG[priority];
}

/**
 * Takes the *domain* signature status, not the prototype's.
 *
 * The two vocabularies differ — the prototype said "Pending signature" and
 * "Final", the domain says "Awaiting signature" and "Not required" — and this
 * followed the domain when the register moved onto real data. "Awaiting" is
 * outlined because it is the one state that is a piece of outstanding work;
 * signed and not-required are both settled, and a settled document should not
 * shout.
 */
export function signatureTag(status: SignatureStatus): TagClass {
  return status === "Awaiting signature" ? "tag tag-outline" : "tag tag-accent";
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

/**
 * Reads a "HH:MM" time field, or null when the value is malformed.
 *
 * `Number.isFinite` alone cannot narrow the destructured parts: a short value
 * like "14" yields no minutes at all, so the absent case has to be handled
 * before the finite check rather than folded into it.
 */
function parseClock(value: string): { hours: number; minutes: number } | null {
  const [hours, minutes] = value.split(":").map(Number);
  if (hours === undefined || minutes === undefined) return null;
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return { hours, minutes };
}

/** A time field's value ("14:30") as the diary writes it ("2:30 PM"). */
export function displayTime(value: string): string {
  const clock = parseClock(value);
  if (!clock) return value;
  const suffix = clock.hours < 12 ? "AM" : "PM";
  const clockHour = clock.hours % 12 === 0 ? 12 : clock.hours % 12;
  return `${clockHour}:${String(clock.minutes).padStart(2, "0")} ${suffix}`;
}

/** Billable hours between two time fields, to the quarter hour. */
export function hoursBetween(start: string, end: string): number {
  const toMinutes = (value: string) => {
    const clock = parseClock(value);
    return clock ? clock.hours * 60 + clock.minutes : Number.NaN;
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
