import { Effect, Option } from "effect";
import Link from "next/link";
import { Empty, PageHead, SectionTitle } from "@/components/ui";
import { may } from "@/domain/identity/permissions";
import { endsAt } from "@/domain/diary/appointment";
import { runAs, signedIn } from "@/runtime/session";
import { AppointmentService } from "@/services/appointment-service";
import type { DiaryEntry } from "@/services/appointment-service";
import { ScheduleAppointmentForm } from "./ScheduleAppointmentForm";

/**
 * The appointment diary, read from Postgres.
 *
 * Grouped by day rather than listed flat, because the question somebody brings
 * to this page is "what is happening on Thursday" and a flat list makes them
 * count. The grouping is done here from a list the service already sorted —
 * one read, one clock reading, so nothing can appear under two days.
 *
 * ## What this page does not do
 *
 * It does not show court dates. That is `/calendar`, and the separation is
 * deliberate: a hearing has a court, a cause number and an outcome that must be
 * recorded, and a diary that mixed the two would offer no way to record one.
 * The *clash check* reads both diaries — see `AppointmentService` — so the two
 * screens are separate without the underlying rule being split.
 *
 * The old mock offered "Court appearance" as an appointment type. It is gone
 * for the same reason.
 */
export default async function AppointmentsPage() {
  const principal = await signedIn();
  const mayWrite = may(principal, "hearing:write");

  const [entries, choices] = await runAs(
    Effect.all(
      [
        Effect.flatMap(AppointmentService, (service) => service.upcoming()),
        mayWrite
          ? Effect.flatMap(AppointmentService, (service) => service.choices())
          : Effect.succeed(undefined),
      ],
      { concurrency: "unbounded" },
    ),
  );

  const days = groupByDay(entries);

  return (
    <>
      <PageHead title="Appointments">
        {mayWrite && choices !== undefined ? (
          <ScheduleAppointmentForm choices={choices} />
        ) : null}
      </PageHead>
      <p className="page-subtitle">
        Consultations, internal meetings and site visits. Booking one checks the
        advocate&rsquo;s court diary as well as this one &mdash; the appointment
        that goes wrong is the one made for a morning somebody is already in
        court.
      </p>

      {days.length === 0 ? (
        <Empty>
          Nothing in the diary. Court dates are kept on the{" "}
          <Link href="/calendar">calendar</Link>.
        </Empty>
      ) : (
        days.map(([day, forDay]) => (
          <section key={day} style={{ marginBottom: "var(--space-5)" }}>
            <SectionTitle>
              {longDay(forDay[0]!.appointment.startsAt)}
            </SectionTitle>
            {forDay.map((entry) => (
              <Booking key={entry.appointment.id} entry={entry} />
            ))}
          </section>
        ))
      )}
    </>
  );
}

function Booking({ entry }: { entry: DiaryEntry }) {
  const { appointment } = entry;

  const client = Option.getOrNull(entry.clientName);
  const matter = Option.getOrNull(entry.matterNumber);

  return (
    <div className="row row-split">
      <div>
        <div className="row-title">{appointment.title}</div>
        <div className="row-meta">
          {[
            appointment.type,
            entry.advocateName,
            client,
            matter,
            appointment.location ?? null,
          ]
            .filter((part): part is string => part !== null)
            .join(" · ")}
        </div>
      </div>
      <div style={{ fontSize: 14, whiteSpace: "nowrap", textAlign: "right" }}>
        {clock(appointment.startsAt)} &ndash; {clock(endsAt(appointment))}
        <div className="dek">{appointment.minutes} min</div>
      </div>
    </div>
  );
}

const clock = (at: Date) =>
  at.toLocaleTimeString("en-KE", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

const longDay = (at: Date) =>
  at.toLocaleDateString("en-KE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

/**
 * Days, in the order the service gave them.
 *
 * A `Map` rather than a sort, because the list arrives sorted and re-sorting it
 * by a key derived from the same dates would be a second opinion about an order
 * that is already settled.
 */
function groupByDay(
  entries: readonly DiaryEntry[],
): readonly (readonly [string, readonly DiaryEntry[]])[] {
  const days = new Map<string, DiaryEntry[]>();

  for (const entry of entries) {
    const key = entry.appointment.startsAt.toDateString();
    const forDay = days.get(key);
    if (forDay === undefined) days.set(key, [entry]);
    else forDay.push(entry);
  }

  return [...days.entries()];
}
