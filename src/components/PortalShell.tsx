"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/app/(auth)/sign-in/actions";
import { type Session, SessionProvider } from "@/components/Session";
import { ThemeChoice } from "@/components/ThemeChoice";
import type { Firm } from "@/lib/firm";
import { PORTAL_NAV } from "@/lib/nav";

/**
 * The client-facing surface. It carries its own masthead and nav rather than
 * the staff chrome — a portal user never sees firm-internal navigation.
 *
 * "Exit portal view" is gone with the role switcher. It was a way to become
 * somebody else, which is what a prototype's role switch is; the button in its
 * place signs out, and getting back to the staff surface means signing in as
 * somebody who works at the firm.
 *
 * The client's name comes from the session rather than from `PORTAL_CLIENT` in
 * the seed data. Same words on the screen, entirely different claim behind
 * them: the fixture said which client the portal *pretends* to be, and this
 * says which client is signed in.
 */
export function PortalShell({
  firm,
  session,
  children,
}: {
  /** Whose practice this is, read by the layout above (D-12). */
  firm: Firm;
  session: Session;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <SessionProvider session={session}>
      <div className="shell">
        <a href="#content" className="skip-link">
          Skip to content
        </a>
        <header className="portal-header">
          <div className="portal-brand">
            <span className="portal-wordmark">{firm.shortName}</span>
            <span className="portal-kicker">CLIENT PORTAL</span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-4)",
            }}
          >
            <ThemeChoice />
            <span className="portal-kicker">{session.principal.name}</span>
            <form action={signOut}>
              <button type="submit" className="btn btn-ghost">
                Sign out
              </button>
            </form>
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

        <main className="portal-content" id="content" tabIndex={-1}>
          <div className="portal-content-inner">{children}</div>
        </main>
      </div>
    </SessionProvider>
  );
}
