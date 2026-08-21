import { Effect } from "effect";
import { may } from "@/domain/identity/permissions";
import { Empty, PageHead, SectionTitle, TableWrap } from "@/components/ui";
import { runAs, signedIn } from "@/runtime/session";
import { HearingService } from "@/services/hearing-service";
import type { DiaryEntry } from "@/services/hearing-service";
import { ListHearingForm } from "./ListHearingForm";
import { RecordOutcomeForm } from "./RecordOutcomeForm";

/**
 * The court diary, read from Postgres.
 *
 * **`awaitingOutcome` is first on the page**, and that ordering is the design.
 * A hearing whose date has passed with nothing recorded is either an
 * administrative gap or a missed attendance, and a firm needs to know which
 * before the other side raises it. Putting the upcoming list first — which is
 * what a calendar screen normally does — would bury the one list that is
 * actually urgent under the one that is merely useful.
 *
 * The three lists come from a single read and a single clock reading, so a
 * hearing cannot appear in two of them.
 */
export default async function CalendarPage() {
  const principal = await signedIn();
  const mayWrite = may(principal, "hearing:write");

  const [diary, choices] = await runAs(
    Effect.all(
      [
        Effect.flatMap(HearingService, (service) => service.diary()),
        mayWrite
          ? Effect.flatMap(HearingService, (service) => service.choices())
          : Effect.succeed(undefined),
      ],
      { concurrency: "unbounded" },
    ),
  );

  return (
    <>
      <PageHead title="Court &amp; Hearing Calendar">
        {mayWrite && choices !== undefined ? (
          <ListHearingForm choices={choices} />
        ) : null}
      </PageHead>
      <p className="page-subtitle">
        The firm&rsquo;s court diary. An adjournment lists the follow-on date in
        the same breath &mdash; a matter adjourned with nowhere recorded to have
        gone is one that has quietly fallen off the diary.
      </p>

      {diary.awaitingOutcome.length > 0 ? (
        <>
          <SectionTitle>Awaiting an outcome</SectionTitle>
          <p className="dek" style={{ marginBottom: "var(--space-2)" }}>
            These dates have passed with nothing recorded. Each is either an
            administrative gap or a missed attendance.
          </p>
          <DiaryTable entries={diary.awaitingOutcome} mayWrite={mayWrite} />
        </>
      ) : null}

      <SectionTitle spaced={diary.awaitingOutcome.length > 0}>
        Upcoming
      </SectionTitle>
      {diary.upcoming.length === 0 ? (
        <Empty>Nothing is listed.</Empty>
      ) : (
        <DiaryTable entries={diary.upcoming} mayWrite={mayWrite} />
      )}

      {diary.past.length > 0 ? (
        <>
          <SectionTitle spaced>Recorded</SectionTitle>
          <DiaryTable entries={diary.past} mayWrite={false} />
        </>
      ) : null}
    </>
  );
}

/**
 * How a hearing went, as one line.
 *
 * An adjournment shows where the matter went, because that is the fact worth
 * seeing — the domain requires it and there is no reason to make somebody open
 * the record to read it.
 */
const outcomeOf = (entry: DiaryEntry): string => {
  const outcome = entry.hearing.outcome;
  if (outcome === undefined) return "—";

  switch (outcome._tag) {
    case "Adjourned":
      return `Adjourned to ${outcome.adjournedTo.toLocaleDateString("en-KE")} — ${outcome.reason}`;
    case "Heard":
      return outcome.note === undefined ? "Heard" : `Heard — ${outcome.note}`;
    case "NotReached":
      return "Not reached";
    case "Withdrawn":
      return "Withdrawn";
  }
};

function DiaryTable({
  entries,
  mayWrite,
}: {
  entries: readonly DiaryEntry[];
  mayWrite: boolean;
}) {
  return (
    <TableWrap>
      <table className="table">
        <thead>
          <tr>
            <th>When</th>
            <th>Matter</th>
            <th>Court</th>
            <th>Advocate</th>
            <th>Outcome</th>
            {mayWrite ? <th /> : null}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.hearing.id}>
              <td>
                {entry.hearing.scheduledFor.toLocaleDateString("en-KE")}
                <div className="dek">
                  {entry.hearing.scheduledFor.toLocaleTimeString("en-KE", {
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "UTC",
                  })}{" "}
                  · {entry.hearing.kind}
                </div>
              </td>
              <td>
                <strong>{entry.matterNumber}</strong>
                <div className="dek">{entry.clientName}</div>
              </td>
              <td>
                {entry.courtName}
                {entry.hearing.room === undefined ? null : (
                  <div className="dek">Court {entry.hearing.room}</div>
                )}
              </td>
              <td>{entry.advocateName}</td>
              <td>{outcomeOf(entry)}</td>
              {mayWrite ? (
                <td className="cell-action">
                  {entry.hearing.outcome === undefined ? (
                    <RecordOutcomeForm
                      hearingId={entry.hearing.id}
                      matterNumber={entry.matterNumber}
                      scheduledFor={entry.hearing.scheduledFor.toLocaleDateString(
                        "en-KE",
                      )}
                    />
                  ) : null}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}
