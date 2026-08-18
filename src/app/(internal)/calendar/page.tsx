import Link from "next/link";
import { SectionTitle } from "@/components/ui";
import { HEARINGS, courtWeek } from "@/lib/data/hearings";

export default function CalendarPage() {
  const week = courtWeek();

  return (
    <>
      <h1 className="page-title">Court &amp; Hearing Calendar</h1>
      <p className="page-subtitle">
        The firm&rsquo;s daily court diary, with adjournment tracking and smart
        reminders per listing.
      </p>

      <div className="week-grid">
        {week.map((day, index) => (
          <div
            className={day.isToday ? "day day-today" : "day"}
            key={`${day.label}-${index}`}
          >
            <div className="day-name">{day.label}</div>
            <div className="day-date">{day.date}</div>
            <div className="day-count">{day.count} hearings</div>
          </div>
        ))}
      </div>

      <SectionTitle>Court diary</SectionTitle>
      {HEARINGS.map((hearing) => (
        <Link
          key={hearing.id}
          href={`/calendar/${hearing.id}`}
          className="row row-split row-link"
        >
          <div>
            <div className="row-title">{hearing.caseTitle}</div>
            <div className="row-meta">
              {hearing.court} · Room {hearing.room} · {hearing.judge} ·{" "}
              {hearing.advocate}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 14 }}>
              {hearing.date} {hearing.time}
            </div>
            <span className="tag tag-outline">{hearing.status}</span>
          </div>
        </Link>
      ))}
    </>
  );
}
