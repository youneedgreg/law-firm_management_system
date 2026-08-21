import { Effect, Option } from "effect";
import Link from "next/link";
import { SectionTitle, Stat } from "@/components/ui";
import { roleLabel } from "@/domain/identity/principal";
import * as Money from "@/domain/shared/money";
import { runAs, signedIn } from "@/runtime/session";
import type { Dashboard } from "@/services/dashboard-service";
import { DashboardService } from "@/services/dashboard-service";

/**
 * The dashboard, on real data.
 *
 * ## It moved to the server, and the masthead came with it
 *
 * It used to be two client components merging `lib/data` constants with
 * whatever the in-browser store had accumulated — `[...records.hearings,
 * ...HEARINGS]`. Both are gone. Every figure now comes from
 * `DashboardService`, which composes the same services the pages behind each
 * number use, so a partner reading "6 unpaid" here and counting six on
 * `/billing` is seeing one fact rather than two that agree by luck.
 *
 * The masthead was a client component only because it needed the signed-in
 * role, which is now a server read. Nothing on this page needs the browser, so
 * nothing on it ships to the browser.
 *
 * ## A missing band is not a zero
 *
 * A Receptionist has no `invoice:read` and sees no money at all — not "Ksh 0",
 * which would be a lie about the firm rather than a statement about the reader.
 * The same for a Finance Officer and the court diary. The service decides;
 * this page only declines to render what it was not given.
 */
export default async function DashboardPage() {
  const principal = await signedIn();
  const home = await runAs(
    Effect.flatMap(DashboardService, (service) => service.home()),
  );

  const isAdvocate =
    principal._tag === "Staff" && principal.role === "Advocate";

  const busiestStatus = Math.max(1, ...home.byStatus.map((row) => row.count));

  return (
    <>
      <h1 className="page-title">
        {isAdvocate
          ? `Good day, ${principal.name.replace("Adv. ", "")}`
          : `${roleLabel(principal)} dashboard`}
      </h1>
      <p className="page-subtitle">
        {isAdvocate
          ? "Your matters, and what the firm has on."
          : "Firm-wide overview across all active matters."}
      </p>

      <Band home={home} isAdvocate={isAdvocate} />

      <div className="widget-grid">
        <section>
          <SectionTitle>Cases by status</SectionTitle>
          {home.byStatus.map((row) => (
            <div className="bar-row" key={row.status}>
              <div className="bar-head">
                <span>{row.status}</span>
                <span>{row.count}</span>
              </div>
              <div className="bar-track">
                <div
                  className="bar-fill"
                  style={{
                    width: `${String(Math.round((row.count / busiestStatus) * 100))}%`,
                  }}
                />
              </div>
            </div>
          ))}

          {home.monthly === undefined ? null : (
            <MonthlyRevenue months={home.monthly} />
          )}
        </section>

        <section>
          <SectionTitle>Next court dates</SectionTitle>
          {home.courtDates.length === 0 ? (
            <p className="line-muted">Nothing listed.</p>
          ) : (
            home.courtDates.map((entry) => (
              <Link
                key={entry.hearing.id}
                href={`/calendar/${entry.hearing.id}`}
                className="row row-link"
              >
                <div className="row-title">{entry.matterTitle}</div>
                <div className="row-meta">
                  {entry.hearing.scheduledFor.toLocaleDateString("en-KE", {
                    day: "numeric",
                    month: "short",
                  })}{" "}
                  · {entry.courtName} · {entry.advocateName}
                </div>
              </Link>
            ))
          )}

          <SectionTitle spaced>Advocate workload</SectionTitle>
          {home.workload.map((line) => (
            <div className="row row-split" key={line.advocateName}>
              <span>{line.advocateName}</span>
              <span className="row-meta">
                {line.count} open {line.count === 1 ? "matter" : "matters"}
              </span>
            </div>
          ))}

          {home.activity === undefined ? null : (
            <>
              <SectionTitle spaced>Recent activity</SectionTitle>
              {home.activity.map((entry) => (
                <div className="line-muted" key={entry.id}>
                  {entry.actor.name} — {entry.action.toLowerCase()}{" "}
                  {Option.getOrElse(
                    Option.map(entry.entityId, () =>
                      entry.entity.toLowerCase(),
                    ),
                    () => "",
                  )}{" "}
                  (
                  {entry.at.toLocaleDateString("en-KE", {
                    day: "numeric",
                    month: "short",
                  })}
                  )
                </div>
              ))}
            </>
          )}
        </section>
      </div>
    </>
  );
}

/**
 * The stat band.
 *
 * Each figure is rendered only if the service supplied it. `?? 0` would have
 * been shorter and would have told a Receptionist the firm holds nothing on
 * trust.
 */
function Band({ home, isAdvocate }: { home: Dashboard; isAdvocate: boolean }) {
  const { band } = home;

  return (
    <div className="stat-grid stat-grid-ruled">
      <Stat
        label={isAdvocate ? "My active cases" : "Active cases"}
        value={band.activeCases}
        tone="accent"
      />
      {band.upcomingHearings === undefined ? null : (
        <Stat label="Upcoming hearings" value={band.upcomingHearings} />
      )}
      {band.openTasks === undefined ? null : (
        <Stat label="Open tasks" value={band.openTasks} />
      )}
      {band.unpaidInvoices === undefined ? null : (
        <Stat
          label="Unpaid fee notes"
          value={band.unpaidInvoices}
          tone="accent-2"
        />
      )}
      {band.collectedThisMonth === undefined ? null : (
        <Stat
          label={`Collected (${home.asAt.toLocaleDateString("en-KE", { month: "short" })})`}
          value={Money.format(band.collectedThisMonth)}
        />
      )}
      {band.trustHeld === undefined ? null : (
        <Stat label="Held on trust" value={Money.format(band.trustHeld)} />
      )}
    </div>
  );
}

/**
 * Six months of billing and collection.
 *
 * The bars are scaled against the tallest **billed** figure rather than each
 * against itself, so the gap between what was billed and what came in is the
 * thing the eye reads. That gap is the point of the chart.
 */
function MonthlyRevenue({
  months,
}: {
  months: readonly {
    month: string;
    billed: Money.Money;
    collected: Money.Money;
  }[];
}) {
  /**
   * `Money` is a branded integer of cents, so it is already a number here. The
   * brand exists to stop it being *mixed* with other numbers, not to stop it
   * being one — and a bar height is the one legitimate place to read the
   * magnitude directly rather than through `format`.
   */
  const peak = Math.max(1, ...months.map((month) => month.billed));

  return (
    <>
      <SectionTitle spaced>Billed and collected</SectionTitle>
      <div className="chart">
        {months.map((month) => (
          <div className="chart-col" key={month.month}>
            <div
              className="chart-bar"
              style={{
                height: `${String(Math.round((month.collected / peak) * 100))}%`,
              }}
              title={`${month.month}: ${Money.format(month.collected)} collected of ${Money.format(month.billed)} billed`}
            />
            <span className="chart-label">{month.month.slice(5)}</span>
          </div>
        ))}
      </div>
    </>
  );
}
