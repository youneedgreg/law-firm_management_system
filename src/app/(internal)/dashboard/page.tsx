import Link from "next/link";
import { DashboardHeader, DashboardStats } from "./DashboardHeader";
import { SectionTitle } from "@/components/ui";
import { MONTHLY_REVENUE } from "@/lib/data/billing";
import { advocateWorkload, caseStatusCounts } from "@/lib/data/cases";
import { AUDIT_LOG } from "@/lib/data/firm";
import { HEARINGS } from "@/lib/data/hearings";

export default function DashboardPage() {
  const byStatus = caseStatusCounts();
  const busiestStatus = Math.max(...byStatus.map((row) => row.count));
  const peakRevenue = Math.max(...MONTHLY_REVENUE.map((month) => month.value));
  const workload = advocateWorkload();
  const courtDatesThisWeek = HEARINGS.slice(0, 4);
  const recentActivity = AUDIT_LOG.slice(0, 5);

  return (
    <>
      <DashboardHeader />
      <DashboardStats />

      <div className="widget-grid">
        <section>
          <SectionTitle>Cases by status</SectionTitle>
          {byStatus.map((row) => (
            <div className="bar-row" key={row.label}>
              <div className="bar-head">
                <span>{row.label}</span>
                <span>{row.count}</span>
              </div>
              <div className="bar-track">
                <div
                  className="bar-fill"
                  style={{
                    width: `${Math.round((row.count / busiestStatus) * 100)}%`,
                  }}
                />
              </div>
            </div>
          ))}

          <SectionTitle spaced>Monthly revenue</SectionTitle>
          <div className="chart">
            {MONTHLY_REVENUE.map((month) => (
              <div className="chart-col" key={month.label}>
                <div
                  className="chart-bar"
                  style={{
                    height: `${Math.round((month.value / peakRevenue) * 100)}%`,
                  }}
                  title={`${month.label}: KES ${month.value.toLocaleString("en-KE")}`}
                />
                <span className="chart-label">{month.label}</span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <SectionTitle>Court dates this week</SectionTitle>
          {courtDatesThisWeek.map((hearing) => (
            <Link
              key={hearing.id}
              href={`/calendar/${hearing.id}`}
              className="row row-link"
            >
              <div className="row-title">{hearing.caseTitle}</div>
              <div className="row-meta">
                {hearing.date} · {hearing.court} · {hearing.advocate}
              </div>
            </Link>
          ))}

          <SectionTitle spaced>Advocate workload</SectionTitle>
          {workload.map((advocate) => (
            <div className="row row-split" key={advocate.name}>
              <span>{advocate.name}</span>
              <span className="row-meta">{advocate.count} active cases</span>
            </div>
          ))}

          <SectionTitle spaced>Recent activity</SectionTitle>
          {recentActivity.map((entry) => (
            <div className="line-muted" key={`${entry.time}-${entry.action}`}>
              {entry.user} — {entry.action.toLowerCase()} ({entry.time})
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
