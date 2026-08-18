import type { Role } from "./types";

export interface NavItem {
  href: string;
  label: string;
  /** Phosphor duotone class, per the design system's icon guidance. */
  icon: string;
  /** `"all"` means every internal role; otherwise an explicit allow-list. */
  roles: "all" | Role[];
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

/** The sidebar menu of section 5 of the spec, grouped and role-gated. */
export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Overview",
    items: [
      {
        href: "/dashboard",
        label: "Dashboard",
        icon: "ph-duotone ph-gauge",
        roles: "all",
      },
    ],
  },
  {
    label: "Practice",
    items: [
      {
        href: "/clients",
        label: "Clients",
        icon: "ph-duotone ph-users",
        roles: [
          "System Administrator",
          "Managing Partner",
          "Advocate/Lawyer",
          "Legal Assistant/Paralegal",
          "Receptionist",
        ],
      },
      {
        href: "/cases",
        label: "Cases",
        icon: "ph-duotone ph-briefcase",
        roles: [
          "System Administrator",
          "Managing Partner",
          "Advocate/Lawyer",
          "Legal Assistant/Paralegal",
        ],
      },
      {
        href: "/calendar",
        label: "Court Diary",
        icon: "ph-duotone ph-calendar-check",
        roles: [
          "System Administrator",
          "Managing Partner",
          "Advocate/Lawyer",
          "Legal Assistant/Paralegal",
          "Receptionist",
        ],
      },
      {
        href: "/documents",
        label: "Documents",
        icon: "ph-duotone ph-folder",
        roles: [
          "System Administrator",
          "Managing Partner",
          "Advocate/Lawyer",
          "Legal Assistant/Paralegal",
        ],
      },
      {
        href: "/tasks",
        label: "Tasks",
        icon: "ph-duotone ph-check-square",
        roles: [
          "System Administrator",
          "Managing Partner",
          "Advocate/Lawyer",
          "Legal Assistant/Paralegal",
        ],
      },
      {
        href: "/time",
        label: "Time Tracking",
        icon: "ph-duotone ph-clock",
        roles: [
          "Managing Partner",
          "Advocate/Lawyer",
          "Legal Assistant/Paralegal",
          "Finance Officer",
        ],
      },
    ],
  },
  {
    label: "Finance",
    items: [
      {
        href: "/billing",
        label: "Billing",
        icon: "ph-duotone ph-receipt",
        roles: ["System Administrator", "Managing Partner", "Finance Officer"],
      },
    ],
  },
  {
    label: "Front office",
    items: [
      {
        href: "/appointments",
        label: "Appointments",
        icon: "ph-duotone ph-calendar-plus",
        roles: ["Managing Partner", "Advocate/Lawyer", "Receptionist"],
      },
      {
        href: "/communications",
        label: "Communications",
        icon: "ph-duotone ph-chats",
        roles: "all",
      },
    ],
  },
  {
    label: "Insight",
    items: [
      {
        href: "/reports",
        label: "Reports",
        icon: "ph-duotone ph-chart-bar",
        roles: ["System Administrator", "Managing Partner", "Finance Officer"],
      },
      {
        href: "/knowledge",
        label: "Knowledge Base",
        icon: "ph-duotone ph-book-open-text",
        roles: [
          "Managing Partner",
          "Advocate/Lawyer",
          "Legal Assistant/Paralegal",
          "System Administrator",
        ],
      },
    ],
  },
  {
    label: "Admin",
    items: [
      {
        href: "/compliance",
        label: "Compliance & Audit",
        icon: "ph-duotone ph-shield-check",
        roles: ["System Administrator", "Managing Partner"],
      },
      {
        href: "/notifications",
        label: "Notifications",
        icon: "ph-duotone ph-bell",
        roles: "all",
      },
      {
        href: "/hr",
        label: "HR & Staff",
        icon: "ph-duotone ph-identification-badge",
        roles: ["System Administrator", "Managing Partner"],
      },
      {
        href: "/users",
        label: "Users & Settings",
        icon: "ph-duotone ph-gear",
        roles: ["System Administrator"],
      },
    ],
  },
];

const ALL_ITEMS = NAV_SECTIONS.flatMap((section) => section.items);

export function roleCanSee(item: NavItem, role: Role): boolean {
  // The portal role has no internal navigation at all.
  if (role === "Client Portal User") return false;
  return item.roles === "all" || item.roles.includes(role);
}

export function visibleSections(role: Role): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    label: section.label,
    items: section.items.filter((item) => roleCanSee(item, role)),
  })).filter((section) => section.items.length > 0);
}

/**
 * The nav item a pathname belongs to — `/cases/4` resolves to the Cases item,
 * so detail routes inherit their section's permissions and its active state.
 */
export function itemForPath(pathname: string): NavItem | undefined {
  return ALL_ITEMS.filter(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  ).sort((a, b) => b.href.length - a.href.length)[0];
}

export function canAccessPath(pathname: string, role: Role): boolean {
  const item = itemForPath(pathname);
  // Routes outside the menu (the landing redirect) are never gated.
  return item ? roleCanSee(item, role) : true;
}

/** What each role may reach — shown on the Users & Permissions screen. */
export const ROLE_ACCESS: Record<Role, string> = {
  "System Administrator": "Full system access",
  "Managing Partner": "All cases, firm reports",
  "Advocate/Lawyer": "Assigned cases only",
  "Legal Assistant/Paralegal": "Filings, documents, hearings",
  "Finance Officer": "Billing & trust accounts",
  Receptionist: "Client intake, appointments",
  "Client Portal User": "Own cases & invoices only",
};
