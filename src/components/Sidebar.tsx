"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { ThemeChoice } from "@/components/ThemeChoice";
import { itemForPath, visibleSections } from "@/lib/nav";
import type { Role } from "@/domain/firm/advocate";

interface SidebarProps {
  role: Role;
  /** Mobile only — the drawer is always shown from 900px up. */
  open: boolean;
  onClose: () => void;
  /**
   * The control that opened the drawer, so focus can be put back on it.
   *
   * Passed in rather than looked up: `document.querySelector(".nav-toggle")`
   * would work and would tie this component to a class name in another one,
   * where nothing would notice the day it changed.
   */
  returnFocusTo: React.RefObject<HTMLElement | null>;
}

/**
 * The role-filtered navigation, and below 900px the drawer it becomes.
 *
 * **The drawer is where the keyboard work is.** From 900px up this is an
 * ordinary column of links and none of the code below runs; under it, the same
 * element is a panel over the page, and a panel that can be opened has to be
 * closable and escapable by the same means it was opened with.
 *
 * Three things, and each covers a way out that the mouse already had:
 *
 * - **Escape closes it** (WCAG 2.1.2). A drawer that can only be dismissed by
 *   clicking the scrim is a keyboard trap in everything but name — the links
 *   inside it all navigate, so tabbing past the end is the only other exit.
 * - **Focus moves into it on open**, so the next Tab is the first nav item
 *   rather than whatever followed the toggle in the masthead. Without this the
 *   drawer is open on screen and the keyboard is still in the header.
 * - **Focus returns to the toggle on close** (2.4.3). It is the control that
 *   opened the drawer and the only one still on screen afterwards; leaving
 *   focus on a link that has just been hidden drops it to the document body
 *   and starts the next Tab from the top of the page.
 *
 * The effect is deliberately keyed on `open` alone. Running it on mount would
 * steal focus on every page load at desktop width, where there is no drawer
 * and nothing was opened.
 */
export function Sidebar({ role, open, onClose, returnFocusTo }: SidebarProps) {
  const pathname = usePathname();
  const active = itemForPath(pathname);
  const sections = visibleSections(role);

  const navRef = useRef<HTMLElement>(null);
  /**
   * Whether this render follows an *open*, rather than being the first one.
   *
   * The close half must not run before the drawer has ever been opened, or
   * every desktop page load would pull focus to a toggle that is not shown.
   */
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      navRef.current?.querySelector("a")?.focus();
      return;
    }
    if (wasOpen.current) {
      returnFocusTo.current?.focus();
    }
    return;
  }, [open, returnFocusTo]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <>
      {open && (
        <button
          type="button"
          className="scrim"
          aria-label="Close navigation"
          onClick={onClose}
        />
      )}
      <nav
        ref={navRef}
        id="main-nav"
        className={open ? "sidebar is-open" : "sidebar"}
        aria-label="Main"
      >
        {sections.map((section) => (
          <div className="sidebar-section" key={section.label}>
            <div className="sidebar-label">{section.label}</div>
            {section.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="sidebar-link"
                aria-current={active?.href === item.href ? "page" : undefined}
                onClick={onClose}
              >
                <i className={item.icon} aria-hidden />
                <span>{item.label}</span>
              </Link>
            ))}
          </div>
        ))}
        <ThemeChoice />
      </nav>
    </>
  );
}
