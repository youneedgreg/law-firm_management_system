"use client";

import Link from "next/link";
import { signOut } from "@/app/(auth)/sign-in/actions";
import { useSession } from "@/components/Session";
import { roleLabel } from "@/domain/identity/principal";
import { NOTIFICATIONS } from "@/lib/data/firm";
import { initials } from "@/lib/format";

/**
 * The masthead.
 *
 * Where the role switcher used to be there is now a name, a role and a way
 * out. That is the visible half of Phase 6: the prototype let you *choose* to
 * be a Managing Partner, and the difference between that and signing in as one
 * is the whole phase.
 *
 * Sign-out is a `<form action={…}>` around a Server Action rather than a button
 * with an `onClick`. Three things follow from that and all of them are wanted:
 * it works before hydration, it is a POST rather than a link (so nothing can
 * sign a person out by embedding an image), and it goes through
 * `IdentityService`, where the audit entry is written.
 *
 * The action is imported from `app/`, which is the one place in this codebase
 * where a component reaches into the route tree. It is deliberate: a Server
 * Action is a function the framework serialises into the form's `action`
 * attribute, not a module this component renders or depends on the shape of,
 * and both shells need the same one. The alternative — a second copy of the
 * action beside each shell — would be two doors to the thing the audit trail
 * is watching.
 */
export function Topbar({ onToggleNav }: { onToggleNav: () => void }) {
  const { principal } = useSession();
  const role = roleLabel(principal);

  return (
    <header className="topbar">
      <button
        type="button"
        className="nav-toggle"
        onClick={onToggleNav}
        aria-label="Toggle navigation"
      >
        <i
          className="ph-duotone ph-list"
          style={{ fontSize: 26 }}
          aria-hidden
        />
      </button>

      <Link
        href="/dashboard"
        className="topbar-brand"
        style={{ color: "inherit", textDecoration: "none" }}
      >
        OKLaw
      </Link>
      <span className="topbar-tagline">Nairobi · General Practice</span>

      <span className="topbar-spacer" />

      <input
        className="input topbar-search"
        type="search"
        placeholder="Search cases, clients, documents…"
        aria-label="Search cases, clients and documents"
      />

      <Link
        href="/notifications"
        className="topbar-icon-btn"
        aria-label={`Notifications (${NOTIFICATIONS.length} unread)`}
      >
        <i
          className="ph-duotone ph-bell"
          style={{ fontSize: 22 }}
          aria-hidden
        />
        <span className="badge" aria-hidden>
          {NOTIFICATIONS.length}
        </span>
      </Link>

      <div className="topbar-identity">
        <span className="topbar-name">{principal.name}</span>
        <span className="topbar-role">{role}</span>
      </div>

      <div className="avatar" title={`${principal.name} · ${role}`}>
        {initials(principal.name)}
      </div>

      <form action={signOut}>
        <button type="submit" className="btn btn-ghost">
          Sign out
        </button>
      </form>
    </header>
  );
}
