"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRx } from "@effect-rx/rx-react";
import { SelectControl } from "@/components/form";
import { NOTIFICATIONS } from "@/lib/data/firm";
import { initials } from "@/lib/format";
import { roleRx } from "@/rx/session";
import { ROLES, type Role } from "@/lib/types";

export function Topbar({ onToggleNav }: { onToggleNav: () => void }) {
  const [role, setRole] = useRx(roleRx);
  const router = useRouter();

  function changeRole(next: Role) {
    setRole(next);
    // The portal is a separate surface, not a filtered view of the internal
    // one — switching into (or out of) that role changes which app you are in.
    router.push(next === "Client Portal User" ? "/portal" : "/dashboard");
  }

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

      <SelectControl
        className="role-select"
        value={role}
        onChange={(event) => changeRole(event.target.value as Role)}
        aria-label="Switch role"
        options={ROLES}
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

      <div className="avatar" title={role}>
        {initials(role)}
      </div>
    </header>
  );
}
