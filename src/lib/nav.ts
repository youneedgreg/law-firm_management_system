import type { Role } from "@/domain/firm/advocate";

/**
 * The menu, and who sees what of it.
 *
 * `Role` is the *domain's* role since Phase 6, not the prototype's — the two
 * lists differed ("Advocate/Lawyer" against "Advocate") and only one of them is
 * now attached to a real staff record. There is no "Client Portal User" among
 * them, because a portal user is a different variant of `Principal` rather than
 * a seventh role, and has its own surface with its own navigation.
 *
 * These allow-lists are **presentation**. The modules that have a service
 * behind them — cases, clients, billing — are gated properly by permissions in
 * `services/`, checked on every read; this decides what to put in a menu. The
 * two agree today and the service is the one that decides.
 */

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
          "Advocate",
          "Legal Assistant",
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
          "Advocate",
          "Legal Assistant",
        ],
      },
      {
        href: "/calendar",
        label: "Court Diary",
        icon: "ph-duotone ph-calendar-check",
        roles: [
          "System Administrator",
          "Managing Partner",
          "Advocate",
          "Legal Assistant",
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
          "Advocate",
          "Legal Assistant",
        ],
      },
      {
        href: "/tasks",
        label: "Tasks",
        icon: "ph-duotone ph-check-square",
        roles: [
          "System Administrator",
          "Managing Partner",
          "Advocate",
          "Legal Assistant",
        ],
      },
      {
        href: "/time",
        label: "Time Tracking",
        icon: "ph-duotone ph-clock",
        roles: [
          "Managing Partner",
          "Advocate",
          "Legal Assistant",
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
        roles: ["Managing Partner", "Advocate", "Receptionist"],
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
          "Advocate",
          "Legal Assistant",
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
        label: "Users & Permissions",
        icon: "ph-duotone ph-gear",
        /**
         * Opened up in Phase 7, because what the page *is* changed.
         *
         * It was "Users & Settings" and held two things only an administrator
         * should touch: a form that created accounts, and firm-wide settings.
         * Both are gone — accounts are provisioned by the seed with sign-up
         * closed, and every settings field was inert.
         *
         * What is left is the staff directory and the permission table, and
         * neither is privileged: `permissionsForRole` is the same data every
         * refusal in the system already discloses to whoever trips it, and a
         * firm where only the administrator may find out what a Receptionist
         * can reach is a firm where nobody checks.
         *
         * `staff:read` is the underlying grant, and every staff role holds it.
         */
        roles: [
          "System Administrator",
          "Managing Partner",
          "Advocate",
          "Legal Assistant",
          "Finance Officer",
          "Receptionist",
        ],
      },
    ],
  },
];

const ALL_ITEMS = NAV_SECTIONS.flatMap((section) => section.items);

export function roleCanSee(item: NavItem, role: Role): boolean {
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

/**
 * What each role may reach, in a sentence — shown on the Users & Permissions
 * screen.
 *
 * Prose, and prose is all it is. The list of permissions each role actually
 * holds is `BY_ROLE` in `domain/identity/permissions.ts`, and that is the one
 * the services enforce; this summarises it for a reader. The Users screen is
 * still a mock module (Phase 7), which is why it is keyed loosely enough to
 * survive the prototype's own role names — a row it cannot describe gets no
 * description rather than crashing the page.
 */
export const ROLE_ACCESS: Partial<Record<string, string>> = {
  "System Administrator": "Logins and the audit trail",
  "Managing Partner": "All cases, firm reports",
  Advocate: "Cases, clients, fee notes",
  "Legal Assistant": "Filings, documents, hearings",
  "Finance Officer": "Billing & trust accounts",
  Receptionist: "Client intake, appointments",
  "Client Portal User": "Own cases & invoices only",
};

/**
 * The portal's menu.
 *
 * Here rather than in `lib/data/portal.ts`, where it used to sit beside five
 * functions that invented a client's matters, documents, invoices and messages.
 * Those are gone — every portal screen reads its own service — and a navigation
 * list is not mock data: it is the same kind of thing as `NAV_SECTIONS` above,
 * which is why it now lives beside it.
 *
 * No role allow-list, because there is only one kind of portal user. The
 * moment that stops being true this wants the same treatment as `NavItem`.
 */
export const PORTAL_NAV = [
  { href: "/portal", label: "Overview" },
  { href: "/portal/cases", label: "My Cases" },
  { href: "/portal/documents", label: "Documents" },
  { href: "/portal/invoices", label: "Invoices" },
  { href: "/portal/messages", label: "Messages" },
] as const;
