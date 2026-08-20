"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { type Session, SessionProvider } from "@/components/Session";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { canAccessPath, itemForPath } from "@/lib/nav";

/**
 * The internal (staff-facing) chrome: masthead, role-filtered sidebar, and the
 * menu's own view of what this role can reach.
 *
 * The role now comes from the session — a prop, resolved by the layout on the
 * server — rather than from `roleRx`, the atom that let the prototype's
 * switcher choose one. That atom is gone. It was the right thing for a
 * wireframe and became the wrong thing the moment there was a real session:
 * a role a browser can set is not a role, and every screen it gated was gated
 * by a value the person reading it could change.
 *
 * **What this component does is presentation.** Hiding a menu item and showing
 * "not available to your role" are affordances — they save somebody a wasted
 * click and tell them why. The authorization is in `services/`, checked on
 * every read and every write, and it does not know this component exists.
 */
export function InternalShell({
  session,
  children,
}: {
  session: Session;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);

  const role =
    session.principal._tag === "Staff" ? session.principal.role : undefined;

  return (
    <SessionProvider session={session}>
      <div className="shell">
        <Topbar onToggleNav={() => setNavOpen((open) => !open)} />
        <div className="shell-body">
          {role !== undefined && (
            <Sidebar
              role={role}
              open={navOpen}
              onNavigate={() => setNavOpen(false)}
            />
          )}
          <main className="content">
            {role !== undefined && canAccessPath(pathname, role) ? (
              children
            ) : (
              <NoAccess pathname={pathname} role={role ?? "Client"} />
            )}
          </main>
        </div>
      </div>
    </SessionProvider>
  );
}

function NoAccess({ pathname, role }: { pathname: string; role: string }) {
  const item = itemForPath(pathname);
  return (
    <div className="no-access">
      <i className="ph-duotone ph-lock-key" aria-hidden />
      <h1 className="page-title">Not available to your role</h1>
      <p className="dek">
        {item ? `“${item.label}” is` : "This screen is"} closed to the{" "}
        <strong>{role}</strong> role. Ask a System Administrator if you need
        access to it.
      </p>
      <Link href="/dashboard" className="btn btn-secondary">
        Back to dashboard
      </Link>
    </div>
  );
}
