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

/** The outcome of the conflict-of-interest check run when a client is taken on. */
export const CONFLICT_STATUSES = [
  "No conflict found",
  "Conflict check pending",
  "Conflict declared",
] as const;

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

export const HEARING_STATUSES = [
  "Confirmed",
  "Awaiting confirmation",
  "Adjourned",
] as const;

export type HearingStatus = (typeof HEARING_STATUSES)[number];

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

export const SIGNATURE_STATUSES = ["Signed", "Pending signature", "Final"] as const;

export type SignatureStatus = (typeof SIGNATURE_STATUSES)[number];

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

/** "Issued" is where a new invoice starts: raised, sent, nothing received yet. */
export const INVOICE_STATUSES = [
  "Issued",
  "Partially Paid",
  "Paid",
  "Overdue",
] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PAYMENT_METHODS = [
  "M-Pesa",
  "Bank Transfer",
  "Cash",
  "Cheque",
  "Card",
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

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

export const PRIORITIES = ["High", "Medium", "Low"] as const;

export type Priority = (typeof PRIORITIES)[number];

export const TASK_STATUSES = [
  "Not started",
  "In progress",
  "Scheduled",
  "Done",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface FirmTask {
  id: number;
  title: string;
  case: string;
  assignee: string;
  priority: Priority;
  due: string;
  status: TaskStatus;
}

export const TIME_ACTIVITIES = [
  "Research",
  "Court attendance",
  "Drafting",
  "Consultation",
  "Admin",
] as const;

export type TimeActivity = (typeof TIME_ACTIVITIES)[number];

export interface TimeEntry {
  id: number;
  case: string;
  lawyer: string;
  activity: TimeActivity;
  start: string;
  end: string;
  hours: number;
  billable: boolean;
}

// ── Front office ──────────────────────────────────────────────────────────

export const APPOINTMENT_TYPES = [
  "Client consultation",
  "Internal meeting",
  "Court appearance",
] as const;

export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];

export interface Appointment {
  id: number;
  title: string;
  with: string;
  type: AppointmentType;
  date: string;
  time: string;
}

export const COMMUNICATION_CHANNELS = [
  "Email",
  "WhatsApp",
  "Call",
  "Meeting",
  "SMS",
] as const;

export type CommunicationChannel = (typeof COMMUNICATION_CHANNELS)[number];

export interface Communication {
  id: number;
  channel: CommunicationChannel;
  with: string;
  summary: string;
  date: string;
  icon: string;
}

// ── Knowledge, audit, notifications, people ───────────────────────────────

export const KNOWLEDGE_CATEGORIES = [
  "Acts",
  "Legal templates",
  "Case law",
  "Precedents",
  "Regulations",
] as const;

export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];

export interface KnowledgeItem {
  id: number;
  title: string;
  category: KnowledgeCategory;
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

export const ACCOUNT_STATUSES = ["Active", "Suspended"] as const;

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export interface UserAccount {
  name: string;
  role: Role;
  status: AccountStatus;
}

// ── Firm settings ─────────────────────────────────────────────────────────

export const CURRENCIES = ["KES", "USD", "EUR", "GBP", "TZS", "UGX"] as const;

export const TIMEZONES = [
  "Africa/Nairobi",
  "Africa/Dar_es_Salaam",
  "Africa/Kampala",
  "Europe/London",
  "UTC",
] as const;

export const DATE_FORMATS = [
  "DD MMM YYYY",
  "DD/MM/YYYY",
  "MM/DD/YYYY",
  "YYYY-MM-DD",
] as const;

export const NOTIFICATION_CHANNELS = [
  "In-app",
  "Email",
  "SMS",
  "WhatsApp",
] as const;

/** Section 5 of the spec — the firm-wide preferences an administrator sets. */
export interface FirmSettings {
  firmName: string;
  currency: (typeof CURRENCIES)[number];
  timezone: (typeof TIMEZONES)[number];
  dateFormat: (typeof DATE_FORMATS)[number];
  /** Channels reminders and alerts go out on. */
  channels: string[];
}

// ── Portal ────────────────────────────────────────────────────────────────

export interface PortalMessage {
  from: string;
  date: string;
  text: string;
}
