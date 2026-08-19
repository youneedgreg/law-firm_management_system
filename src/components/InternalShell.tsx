"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useRxValue } from "@effect-rx/rx-react";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { canAccessPath, itemForPath } from "@/lib/nav";
import { hydratedRx, roleRx } from "@/rx/session";

/**
 * The internal (staff-facing) chrome: masthead, role-filtered sidebar, and the
 * permission guard. The prototype only hid nav items a role could not use;
 * here the route itself is closed too, so a bookmarked or typed URL cannot
 * walk around the menu.
 */
export function InternalShell({ children }: { children: React.ReactNode }) {
  const role = useRxValue(roleRx);
  const hydrated = useRxValue(hydratedRx);
  const pathname = usePathname();
  const router = useRouter();
  const [navOpen, setNavOpen] = useState(false);

  // The portal role has no internal surface at all — send it home.
  useEffect(() => {
    if (hydrated && role === "Client Portal User") router.replace("/portal");
  }, [hydrated, role, router]);

  const allowed = canAccessPath(pathname, role);

  return (
    <div className="shell">
      <Topbar onToggleNav={() => setNavOpen((open) => !open)} />
      <div className="shell-body">
        <Sidebar
          role={role}
          open={navOpen}
          onNavigate={() => setNavOpen(false)}
        />
        <main className="content">
          {allowed ? children : <NoAccess pathname={pathname} role={role} />}
        </main>
      </div>
    </div>
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
        <strong>{role}</strong> role. Switch roles in the masthead, or ask a
        System Administrator to widen your permissions.
      </p>
      <Link href="/dashboard" className="btn btn-secondary">
        Back to dashboard
      </Link>
    </div>
  );
}
