import Link from "next/link";
import { BackLink, SectionTitle } from "@/components/ui";
import type { Case, Hearing } from "@/lib/types";

/** Section D of the spec — who gets reminded, and through which channel. */
const REMINDERS = ["Advocate — Email", "Client — SMS", "Assistant — WhatsApp"];

export function HearingDetail({
  hearing,
  legalCase,
}: {
  hearing: Hearing;
  legalCase?: Case | undefined;
}) {
  return (
    <>
      <BackLink href="/calendar">Back to calendar</BackLink>

      <div className="detail-head">
        <h1 className="detail-title">{hearing.caseTitle}</h1>
        <span className="tag tag-outline">{hearing.status}</span>
      </div>

      <div className="dek" style={{ lineHeight: 1.8 }}>
        {hearing.court}, Room {hearing.room}
        <br />
        {hearing.date} at {hearing.time}
        <br />
        Presiding: {hearing.judge}
        <br />
        Assigned advocate: {hearing.advocate}
        {legalCase && (
          <>
            <br />
            Matter:{" "}
            <Link href={`/cases/${legalCase.id}`}>{legalCase.number}</Link>
          </>
        )}
      </div>

      <SectionTitle spaced>Smart reminders</SectionTitle>
      <div className="tag-row">
        {REMINDERS.map((reminder) => (
          <span className="tag tag-accent" key={reminder}>
            {reminder}
          </span>
        ))}
      </div>
    </>
  );
}
