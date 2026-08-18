import type {
  AppNotification,
  AuditEntry,
  Communication,
  KnowledgeItem,
  StaffMember,
  UserAccount,
} from "../types";

export const COMMUNICATIONS: Communication[] = [
  {
    id: 1,
    channel: "Email",
    with: "Wanjiku Mwangi",
    summary: "Sent hearing date confirmation",
    date: "17 Aug 2026",
    icon: "ph-duotone ph-envelope",
  },
  {
    id: 2,
    channel: "WhatsApp",
    with: "General Innovations Ltd",
    summary: "Shared invoice INV-3002",
    date: "16 Aug 2026",
    icon: "ph-duotone ph-whatsapp-logo",
  },
  {
    id: 3,
    channel: "Call",
    with: "David Odhiambo",
    summary: "Discussed plea strategy",
    date: "15 Aug 2026",
    icon: "ph-duotone ph-phone",
  },
  {
    id: 4,
    channel: "Meeting",
    with: "Coastal Agro Exports Ltd",
    summary: "Site visit debrief",
    date: "14 Aug 2026",
    icon: "ph-duotone ph-users-three",
  },
  {
    id: 5,
    channel: "SMS",
    with: "Rift Valley Logistics Ltd",
    summary: "Reminder: hearing tomorrow",
    date: "13 Aug 2026",
    icon: "ph-duotone ph-chat-circle-text",
  },
  {
    id: 6,
    channel: "Email",
    with: "Grace Njeri",
    summary: "Requested updated ID copy",
    date: "12 Aug 2026",
    icon: "ph-duotone ph-envelope",
  },
];

export const KNOWLEDGE: KnowledgeItem[] = [
  {
    id: 1,
    title: "Employment Act, 2007 (annotated)",
    category: "Acts",
    date: "Updated Jan 2026",
  },
  {
    id: 2,
    title: "Civil Procedure Rules — pleading templates",
    category: "Legal templates",
    date: "Updated Mar 2026",
  },
  {
    id: 3,
    title: "Land Registration Act, 2012",
    category: "Acts",
    date: "Updated Feb 2026",
  },
  {
    id: 4,
    title: "Court of Appeal — recent commercial precedents digest",
    category: "Case law",
    date: "Updated Jul 2026",
  },
  {
    id: 5,
    title: "KRA tax objection procedure — firm precedent bank",
    category: "Precedents",
    date: "Updated Apr 2026",
  },
];

export const AUDIT_LOG: AuditEntry[] = [
  {
    time: "18 Aug 2026 08:12",
    user: "Adv. Sarah Wanjiru",
    action: "Login",
    detail: "Successful login from Nairobi office",
  },
  {
    time: "18 Aug 2026 08:40",
    user: "Legal Assistant - Mercy",
    action: "Document uploaded",
    detail: "Plaint - Wanjiku v Nairobi Metro SACCO.pdf",
  },
  {
    time: "17 Aug 2026 16:02",
    user: "Finance - Peter",
    action: "Payment recorded",
    detail: "INV-3001 marked Paid",
  },
  {
    time: "17 Aug 2026 11:20",
    user: "Adv. Brian Kiptoo",
    action: "Case updated",
    detail: "OKL-2026-005 status changed to Active",
  },
  {
    time: "16 Aug 2026 09:55",
    user: "System Administrator",
    action: "Permission changed",
    detail: "Granted Finance Officer billing access",
  },
  {
    time: "15 Aug 2026 14:31",
    user: "Receptionist - Ann",
    action: "Client intake",
    detail: "New client CLT-1003 created",
  },
];

export const NOTIFICATIONS: AppNotification[] = [
  {
    id: 1,
    text: "Hearing tomorrow: Wanjiku Mwangi v. Nairobi Metro SACCO, 9:00 AM",
    time: "2h ago",
    channel: "Email",
    icon: "ph-duotone ph-gavel",
  },
  {
    id: 2,
    text: "Invoice INV-3003 is now overdue",
    time: "5h ago",
    channel: "In-app",
    icon: "ph-duotone ph-receipt",
  },
  {
    id: 3,
    text: "Task due today: Draft affidavit",
    time: "6h ago",
    channel: "In-app",
    icon: "ph-duotone ph-check-square",
  },
  {
    id: 4,
    text: "Court date added: Rift Valley Logistics Ltd, 22 Aug",
    time: "1d ago",
    channel: "SMS",
    icon: "ph-duotone ph-calendar",
  },
  {
    id: 5,
    text: "New message from General Innovations Ltd",
    time: "1d ago",
    channel: "WhatsApp",
    icon: "ph-duotone ph-chat-circle-text",
  },
  {
    id: 6,
    text: "Document e-signature pending: Master Services Agreement",
    time: "2d ago",
    channel: "Email",
    icon: "ph-duotone ph-signature",
  },
];

export const STAFF: StaffMember[] = [
  { name: "Adv. Sarah Wanjiru", role: "Managing Partner", cases: 3, leave: "14 days" },
  { name: "Adv. Brian Kiptoo", role: "Advocate", cases: 4, leave: "9 days" },
  { name: "Adv. Faith Achieng", role: "Advocate", cases: 2, leave: "18 days" },
  { name: "Legal Assistant - Mercy", role: "Paralegal", cases: 5, leave: "12 days" },
  { name: "Finance - Peter", role: "Finance Officer", cases: 0, leave: "20 days" },
  { name: "Receptionist - Ann", role: "Receptionist", cases: 0, leave: "16 days" },
];

export const USER_ACCOUNTS: UserAccount[] = [
  { name: "System Admin - Kevin", role: "System Administrator", status: "Active" },
  { name: "Adv. Sarah Wanjiru", role: "Managing Partner", status: "Active" },
  { name: "Adv. Brian Kiptoo", role: "Advocate/Lawyer", status: "Active" },
  {
    name: "Legal Assistant - Mercy",
    role: "Legal Assistant/Paralegal",
    status: "Active",
  },
  { name: "Finance - Peter", role: "Finance Officer", status: "Active" },
  { name: "Receptionist - Ann", role: "Receptionist", status: "Active" },
  { name: "Peter Kamau", role: "Client Portal User", status: "Active" },
];
