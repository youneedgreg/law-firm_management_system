"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signOut } from "@/app/(auth)/sign-in/actions";
import { useSession } from "@/components/Session";
import { roleLabel } from "@/domain/identity/principal";
import type { Firm } from "@/lib/firm";
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
export function Topbar({
  firm,
  navOpen,
  onToggleNav,
  toggleRef,
  needsAttention,
}: {
  /** Whose practice this is, read by the layout above (D-12). */
  firm: Firm;
  /** Whether the mobile drawer is showing, for `aria-expanded`. */
  navOpen: boolean;
  onToggleNav: () => void;
  /** So the drawer can put focus back here when it closes. */
  toggleRef: React.RefObject<HTMLButtonElement | null>;
  needsAttention: number;
}) {
  /**
   * The current term, so the box keeps what was searched.
   *
   * A box that empties itself after a search is one people retype into, and
   * refining a search is the commonest thing anybody does with one.
   */
  const term = useSearchParams().get("q") ?? "";
  const pressing = needsAttention;

  const { principal } = useSession();
  const role = roleLabel(principal);

  return (
    <header className="topbar">
      {/*
        `aria-expanded` and `aria-controls` are what make this a disclosure
        rather than a button that does something invisible: without them the
        only way to learn whether the navigation is showing is to see it, and
        the label alone ("Toggle navigation") says what it does and never what
        state it is in.
      */}
      <button
        ref={toggleRef}
        type="button"
        className="nav-toggle"
        onClick={onToggleNav}
        aria-label="Navigation"
        aria-expanded={navOpen}
        aria-controls="main-nav"
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
        {firm.shortName}
      </Link>
      <span className="topbar-tagline">{firm.tagline}</span>

      <span className="topbar-spacer" />

      {/*
        A GET form, not an input with an `onChange`.
        
        Submitting navigates to `/search?q=…`, which makes a search a *place*:
        linkable, in the back-stack, and readable at leisure. A type-ahead
        panel under the box is nicer for the case where the first hit is the
        right one and worse for every other — it cannot be sent to a colleague,
        it vanishes when the mouse moves, and it costs a request per keystroke
        against four tables.

        `method="get"` also means it works before hydration, which is the same
        reason sign-out is a form.
      */}
      <form action="/search" className="topbar-search-form">
        <input
          className="input topbar-search"
          type="search"
          name="q"
          defaultValue={term}
          placeholder="Search cases, clients, documents…"
          aria-label="Search cases, clients and documents"
        />
      </form>

      <Link
        href="/notifications"
        className="topbar-icon-btn"
        aria-label={
          pressing === 0
            ? "Notifications"
            : `Notifications (${String(pressing)} need attention)`
        }
      >
        <i
          className="ph-duotone ph-bell"
          style={{ fontSize: 22 }}
          aria-hidden
        />
        {/* No badge at all when there is nothing, rather than a "0". */}
        {pressing === 0 ? null : (
          <span className="badge" aria-hidden>
            {pressing}
          </span>
        )}
      </Link>

      <div className="topbar-identity">
        <span className="topbar-name">{principal.name}</span>
        <span className="topbar-role">{role}</span>
      </div>

      {/*
        Hidden rather than labelled. The initials are a picture of the name and
        the role printed immediately to their left, so anything announced here
        is the same fact a third time — and the `title` attribute it used to
        carry is not reliably surfaced anyway.
      */}
      <div className="avatar" aria-hidden>
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
