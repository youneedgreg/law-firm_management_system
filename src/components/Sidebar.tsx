"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { itemForPath, visibleSections } from "@/lib/nav";
import type { Role } from "@/domain/firm/advocate";

interface SidebarProps {
  role: Role;
  /** Mobile only — the drawer is always shown from 900px up. */
  open: boolean;
  onNavigate: () => void;
}

export function Sidebar({ role, open, onNavigate }: SidebarProps) {
  const pathname = usePathname();
  const active = itemForPath(pathname);
  const sections = visibleSections(role);

  return (
    <>
      {open && (
        <button
          type="button"
          className="scrim"
          aria-label="Close navigation"
          onClick={onNavigate}
        />
      )}
      <nav className={open ? "sidebar is-open" : "sidebar"} aria-label="Main">
        {sections.map((section) => (
          <div className="sidebar-section" key={section.label}>
            <div className="sidebar-label">{section.label}</div>
            {section.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="sidebar-link"
                aria-current={active?.href === item.href ? "page" : undefined}
                onClick={onNavigate}
              >
                <i className={item.icon} aria-hidden />
                <span>{item.label}</span>
              </Link>
            ))}
          </div>
        ))}
      </nav>
    </>
  );
}
