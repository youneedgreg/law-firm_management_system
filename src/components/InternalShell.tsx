"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { type Session, SessionProvider } from "@/components/Session";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import type { Firm } from "@/lib/firm";
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
  firm,
  session,
  needsAttention,
  children,
}: {
  /** Whose practice this is, read by the layout above (D-12). */
  firm: Firm;
  session: Session;
  /** How many notices are overdue, for the masthead badge. */
  needsAttention: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  const role =
    session.principal._tag === "Staff" ? session.principal.role : undefined;

  return (
    <SessionProvider session={session}>
      <div className="shell">
        {/*
          Twenty navigation links stand between the masthead and the content on
          every screen, and without this a keyboard or switch user walks all of
          them every time (WCAG 2.4.1). `tabIndex={-1}` on the target is what
          makes the jump actually move focus rather than only scroll: without
          it the browser moves the *scroll position* and leaves focus on the
          link, so the next Tab goes back into the navigation.
        */}
        <a href="#content" className="skip-link">
          Skip to content
        </a>
        <Topbar
          firm={firm}
          navOpen={navOpen}
          onToggleNav={() => setNavOpen((open) => !open)}
          toggleRef={toggleRef}
          needsAttention={needsAttention}
        />
        <div className="shell-body">
          {role !== undefined && (
            <Sidebar
              role={role}
              open={navOpen}
              onClose={() => setNavOpen(false)}
              returnFocusTo={toggleRef}
            />
          )}
          <main className="content" id="content" tabIndex={-1}>
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
