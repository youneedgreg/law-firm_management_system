/**
 * Domain types for the OKLaw law-firm management system.
 *
 * The entity set follows section 4 ("Database Core Tables") of the system
 * specification: Clients, Cases, Courts, Hearings, Advocates, Users, Tasks,
 * Documents, Time Entries, Invoices, Payments, Trust Accounts, Appointments,
 * Communications, Audit Logs, Notifications.
 */

/** Section 2 of the spec — the seven user roles the system recognises. */
export const ROLES = [
  "System Administrator",
  "Managing Partner",
  "Advocate/Lawyer",
  "Legal Assistant/Paralegal",
  "Finance Officer",
  "Receptionist",
  "Client Portal User",
] as const;

export type Role = (typeof ROLES)[number];

/** A Broadsheet tag variant. Statuses map onto these rather than raw colors. */
export type TagClass =
  | "tag tag-accent"
  | "tag tag-accent-2"
  | "tag tag-neutral"
  | "tag tag-outline";

// ── Clients ───────────────────────────────────────────────────────────────

export type ClientType = "individual" | "corporate";

export interface Client {
  id: number;
  number: string;
  name: string;
  type: ClientType;
  /** Primary contact person — the client themselves, for individuals. */
  contact: string;
  email: string;
  phone: string;
  activeCases: number;
  conflictStatus: string;
}

export interface Engagement {
  date: string;
  text: string;
}

export interface ClientContact {
  name: string;
  role: string;
}

// ── Cases ─────────────────────────────────────────────────────────────────

export const CASE_TYPES = [
  "Civil",
  "Criminal",
  "Family",
  "Probate",
  "Labour",
  "Land",
  "Commercial",
  "Tax",
  "Constitutional",
  "Arbitration",
] as const;

export type CaseType = (typeof CASE_TYPES)[number];

export const CASE_STATUSES = [
  "New",
  "Active",
  "Hearing Scheduled",
  "Under Review",
  "Judgment Pending",
  "Closed",
  "Appealed",
] as const;

export type CaseStatus = (typeof CASE_STATUSES)[number];

export interface TimelineEvent {
  date: string;
  text: string;
}

export interface HearingRecord {
  date: string;
  court: string;
  outcome: string;
}

export interface Case {
  id: number;
  number: string;
  title: string;
  type: CaseType;
  practiceArea: string;
  court: string;
  judge: string;
  opposingCounsel: string;
  filed: string;
  status: CaseStatus;
  clientId: number;
  advocate: string;
  timeline: TimelineEvent[];
  notes: string[];
  hearings: HearingRecord[];
  documents: string[];
  invoices: string[];
}

// ── Court & hearings ──────────────────────────────────────────────────────

export type HearingStatus = "Confirmed" | "Awaiting confirmation" | "Adjourned";

export interface Hearing {
  id: number;
  caseId: number;
  caseTitle: string;
  court: string;
  room: string;
  date: string;
  time: string;
  judge: string;
  advocate: string;
  status: HearingStatus;
}

// ── Documents ─────────────────────────────────────────────────────────────

export const DOCUMENT_CATEGORIES = [
  "Contracts",
  "Pleadings",
  "Witness Statements",
  "Affidavits",
  "Judgments",
  "Correspondence",
] as const;

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export type SignatureStatus = "Signed" | "Pending signature" | "Final";

export interface DocumentVersion {
  n: number;
  date: string;
  by: string;
}

export interface FirmDocument {
  id: number;
  name: string;
  category: DocumentCategory;
  /** Case number this document belongs to, e.g. "OKL-2026-014". */
  case: string;
  version: number;
  date: string;
  sigStatus: SignatureStatus;
  versions: DocumentVersion[];
  tags: string[];
}

// ── Billing ───────────────────────────────────────────────────────────────

export type InvoiceStatus = "Paid" | "Partially Paid" | "Overdue";

export type PaymentMethod =
  | "M-Pesa"
  | "Bank Transfer"
  | "Cash"
  | "Cheque"
  | "Card";

export interface InvoiceLineItem {
  desc: string;
  qty: number;
  rate: number;
  amount: number;
}

export interface Invoice {
  id: number;
  number: string;
  client: string;
  case: string;
  amount: number;
  method: PaymentMethod;
  status: InvoiceStatus;
  lineItems: InvoiceLineItem[];
}

export interface TrustAccount {
  client: string;
  deposits: number;
  withdrawals: number;
  balance: number;
}

// ── Tasks & time ──────────────────────────────────────────────────────────

export type Priority = "High" | "Medium" | "Low";

export type TaskStatus = "Not started" | "In progress" | "Scheduled" | "Done";

export interface FirmTask {
  id: number;
  title: string;
  case: string;
  assignee: string;
  priority: Priority;
  due: string;
  status: TaskStatus;
}

export interface TimeEntry {
  id: number;
  case: string;
  lawyer: string;
  activity: "Research" | "Court attendance" | "Drafting" | "Consultation" | "Admin";
  start: string;
  end: string;
  hours: number;
  billable: boolean;
}

// ── Front office ──────────────────────────────────────────────────────────

export interface Appointment {
  id: number;
  title: string;
  with: string;
  type: "Client consultation" | "Internal meeting" | "Court appearance";
  date: string;
  time: string;
}

export interface Communication {
  id: number;
  channel: "Email" | "WhatsApp" | "Call" | "Meeting" | "SMS";
  with: string;
  summary: string;
  date: string;
  icon: string;
}

// ── Knowledge, audit, notifications, people ───────────────────────────────

export interface KnowledgeItem {
  id: number;
  title: string;
  category: "Acts" | "Legal templates" | "Case law" | "Precedents" | "Regulations";
  date: string;
}

export interface AuditEntry {
  time: string;
  user: string;
  action: string;
  detail: string;
}

export interface AppNotification {
  id: number;
  text: string;
  time: string;
  channel: "In-app" | "Email" | "SMS" | "WhatsApp";
  icon: string;
}

export interface StaffMember {
  name: string;
  role: string;
  cases: number;
  leave: string;
}

export interface UserAccount {
  name: string;
  role: Role;
  status: "Active" | "Suspended";
}

// ── Portal ────────────────────────────────────────────────────────────────

export interface PortalMessage {
  from: string;
  date: string;
  text: string;
}
