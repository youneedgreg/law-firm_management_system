import { Effect } from "effect";
import { may } from "@/domain/identity/permissions";
import * as Money from "@/domain/shared/money";
import {
  Empty,
  PageHead,
  SectionTitle,
  Stat,
  TableWrap,
} from "@/components/ui";
import { billableTag } from "@/lib/format";
import { runAs, signedIn } from "@/runtime/session";
import { BillingService } from "@/services/billing-service";
import { TimeService } from "@/services/time-service";
import { BillMatterButton } from "./BillMatter";
import { LogTimeForm } from "./LogTimeForm";

/**
 * The timesheet, read from Postgres.
 *
 * A Server Component, for the same reason the billing screen is one: this is a
 * document — what the firm recorded — rather than something the browser
 * interrogates. Filtering it by matter or fee-earner would be interaction and
 * would belong in an atom; it does not exist yet, and the page says so by not
 * offering it rather than by offering a filter that reloads the route.
 *
 * ## Work in progress is the number this page exists for
 *
 * A timesheet is a list. **Unbilled billable time, by matter** is a figure, and
 * it is the one a small practice usually cannot produce: work already done,
 * already recorded, and not yet invoiced. It is shown beside the list with a
 * button that turns it into a fee note, because that is the only action anybody
 * ever wants to take about it.
 */
export default async function TimeTrackingPage() {
  const principal = await signedIn();
  const mayRecord = may(principal, "time:write");
  const mayBill = may(principal, "invoice:write");

  const [timesheet, wip, choices] = await runAs(
    Effect.all(
      [
        Effect.flatMap(TimeService, (time) => time.timesheet()),
        Effect.flatMap(TimeService, (time) => time.workInProgress()),
        mayRecord
          ? Effect.flatMap(BillingService, (billing) => billing.choices()).pipe(
              /**
               * The matter list, borrowed from billing because `choices` is
               * gated on `invoice:write` — which an Advocate does not hold, and
               * an Advocate is exactly who records time. Falling back rather
               * than failing: the form then offers the matters this person can
               * already see on their own timesheet.
               */
              Effect.catchTag("NotPermitted", () => Effect.succeed(undefined)),
            )
          : Effect.succeed(undefined),
      ],
      { concurrency: "unbounded" },
    ),
  );

  /**
   * Every matter the caller could plausibly record against.
   *
   * `choices.matters` when they may raise fee notes, otherwise the matters
   * already on their timesheet — which discloses nothing new, because they are
   * looking at them.
   */
  const matters = choices?.matters ?? [
    ...new Map(
      timesheet.lines.map((line) => [
        line.entry.caseId,
        {
          id: line.entry.caseId,
          number: line.matterNumber,
          title: line.matterTitle,
        },
      ]),
    ).values(),
  ];

  return (
    <>
      <PageHead title="Time Tracking">
        {mayRecord ? <LogTimeForm matters={matters} /> : null}
      </PageHead>
      <p className="page-subtitle">
        Research, court attendance, drafting and consultation time, recorded
        against the matter that will be billed for it. Non-billable work is
        recorded too &mdash; utilisation cannot be computed without it.
      </p>

      <div className="stat-grid" style={{ marginBottom: "var(--space-6)" }}>
        <Stat
          label="Hours recorded"
          value={(Math.round((timesheet.totalMinutes / 60) * 10) / 10).toFixed(
            1,
          )}
          small
        />
        <Stat
          label="Utilisation"
          value={`${String(Math.round(timesheet.utilisation * 100))}%`}
          tone="accent"
          small
        />
        <Stat
          label="Billable value"
          value={Money.format(timesheet.billableValue)}
          small
        />
        <Stat
          label="Not yet billed"
          value={Money.format(timesheet.unbilledValue)}
          tone="accent-2"
          small
        />
      </div>

      {wip.length === 0 ? null : (
        <>
          <SectionTitle>Work in progress</SectionTitle>
          <p className="dek" style={{ marginBottom: "var(--space-2)" }}>
            Billable work recorded and not yet invoiced, largest first.
          </p>
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>Matter</th>
                  <th>Hours</th>
                  <th>Value</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {wip.map((matter) => (
                  <tr key={matter.caseId}>
                    <td>
                      <strong>{matter.matterNumber}</strong>
                      <span className="dek"> {matter.matterTitle}</span>
                    </td>
                    <td>{Math.round((matter.minutes / 60) * 10) / 10}</td>
                    <td className="cell-strong">
                      {Money.format(matter.value)}
                    </td>
                    <td className="cell-action">
                      {mayBill ? (
                        <BillMatterButton
                          caseId={matter.caseId}
                          matterNumber={matter.matterNumber}
                          value={Money.format(matter.value)}
                        />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </>
      )}

      <SectionTitle spaced>Recorded time</SectionTitle>
      {timesheet.lines.length === 0 ? (
        <Empty>No time has been recorded.</Empty>
      ) : (
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Matter</th>
                <th>Fee earner</th>
                <th>Activity</th>
                <th>Hours</th>
                <th>Value</th>
                <th>Billing</th>
              </tr>
            </thead>
            <tbody>
              {timesheet.lines.map((line) => (
                <tr key={line.entry.id}>
                  <td>{line.entry.workedOn.toLocaleDateString("en-KE")}</td>
                  <td>
                    {line.matterNumber}
                    <div className="dek">{line.entry.narrative}</div>
                  </td>
                  <td>{line.advocateName}</td>
                  <td>{line.entry.activity}</td>
                  <td>{line.hours}</td>
                  <td>{Money.format(line.value)}</td>
                  <td>
                    <span className={billableTag(line.entry.billable)}>
                      {line.entry.billable ? "Billable" : "Non-billable"}
                    </span>
                    {/*
                      Billed work is marked, because it is the reason an entry
                      can no longer be corrected — showing the state is what
                      makes the later refusal make sense rather than look
                      arbitrary.
                    */}
                    {line.entry.invoicedOn._tag === "Some" ? (
                      <span className="dek"> · billed</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </>
  );
}
