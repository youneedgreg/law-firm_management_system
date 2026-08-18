"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAppState } from "@/components/AppState";
import { PORTAL_CLIENT, PORTAL_NAV } from "@/lib/data/portal";

/**
 * The client-facing surface. It carries its own masthead and nav rather than
 * the staff chrome — a portal user never sees firm-internal navigation.
 */
export function PortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { setRole } = useAppState();
  const router = useRouter();

  function exitPortal() {
    setRole("Managing Partner");
    router.push("/dashboard");
  }

  return (
    <div className="shell">
      <header className="portal-header">
        <div className="portal-brand">
          <span className="portal-wordmark">OKLaw</span>
          <span className="portal-kicker">CLIENT PORTAL</span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-4)",
          }}
        >
          <span className="portal-kicker">{PORTAL_CLIENT.name}</span>
          <button type="button" className="btn btn-ghost" onClick={exitPortal}>
            Exit portal view
          </button>
        </div>
      </header>

      <nav className="portal-nav" aria-label="Client portal">
        {PORTAL_NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={pathname === item.href ? "page" : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <main className="portal-content">{children}</main>
    </div>
  );
}
