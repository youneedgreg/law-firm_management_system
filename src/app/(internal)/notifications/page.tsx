import Link from "next/link";
import { Effect } from "effect";
import { Empty, SectionTitle } from "@/components/ui";
import { runAs } from "@/runtime/session";
import {
  type Notice,
  NoticeService,
  pressing,
  type Severity,
} from "@/services/notice-service";

/**
 * What needs attention, derived from four modules and stored nowhere.
 *
 * The prototype had a list of notification *rows* — a table this system
 * deliberately does not have. Every notice here is a restatement of a fact that
 * already exists: a hearing on Thursday, a task overdue since Monday, a fee
 * note past due, a client waiting on a reply. Keeping copies would mean writing
 * one when the fact appears, updating it when it changes and deleting it when
 * it resolves — and the familiar failure of every notification inbox ever built
 * is the middle step going missing. A derived feed cannot go stale, because the
 * notice *is* the fact.
 *
 * ## What you see depends on what you may read
 *
 * There is no permission check on this page. Each source is read through its
 * own service, and a refusal means "nothing from there" — so a Receptionist
 * gets the court diary and none of the money, and a Finance Officer the mirror
 * image, without this file knowing either rule. A role that gains a permission
 * gains its notices with nothing to change here.
 */

const TONE: Readonly<Record<Severity, string>> = {
  Overdue: "ink-accent-2",
  Soon: "ink-accent",
  Ahead: "",
};

const ICON: Readonly<Record<Notice["source"], string>> = {
  Hearing: "ph-duotone ph-gavel",
  Task: "ph-duotone ph-check-square",
  Invoice: "ph-duotone ph-receipt",
  Message: "ph-duotone ph-chat-circle-text",
};

export default async function NotificationsPage() {
  const feed = await runAs(
    Effect.flatMap(NoticeService, (service) => service.feed()),
  );

  const urgent = feed.filter((notice) => notice.severity === "Overdue");
  const soon = feed.filter((notice) => notice.severity === "Soon");
  const ahead = feed.filter((notice) => notice.severity === "Ahead");

  return (
    <>
      <h1 className="page-title">Notifications</h1>
      <p className="page-subtitle">
        Court dates, work falling due, fee notes past their date and clients
        waiting on a reply &mdash; read from the records themselves, so nothing
        here can outlive the thing it is about.
      </p>

      {feed.length === 0 ? (
        <Empty>
          Nothing needs your attention. This page reads live records rather than
          a stored inbox, so an empty list means an empty desk.
        </Empty>
      ) : null}

      {urgent.length > 0 ? (
        <>
          <SectionTitle>
            Needs attention now ({String(pressing(feed))})
          </SectionTitle>
          <Notices of={urgent} />
        </>
      ) : null}

      {soon.length > 0 ? (
        <>
          <SectionTitle spaced>This week</SectionTitle>
          <Notices of={soon} />
        </>
      ) : null}

      {ahead.length > 0 ? (
        <>
          <SectionTitle spaced>Later</SectionTitle>
          <Notices of={ahead} />
        </>
      ) : null}
    </>
  );
}

/**
 * One list, three times. The sections differ in urgency, not in what a row
 * shows — and giving each its own markup is how two of them stop matching the
 * third.
 */
function Notices({ of }: { of: readonly Notice[] }) {
  return (
    <>
      {of.map((notice) => (
        <Link
          key={`${notice.source}-${notice.text}-${notice.at.toISOString()}`}
          href={notice.href}
          className="row row-icon"
          style={{ color: "inherit", textDecoration: "none" }}
        >
          <i
            className={`${ICON[notice.source]} ${TONE[notice.severity]}`}
            aria-hidden
          />
          <div>
            <div style={{ fontSize: 14 }}>{notice.text}</div>
            <div className="eyebrow">
              {notice.detail} · {notice.source}
            </div>
          </div>
        </Link>
      ))}
    </>
  );
}
