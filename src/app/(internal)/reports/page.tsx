import Link from "next/link";
import { Effect } from "effect";
import { Empty, SectionTitle, Stat, TableWrap } from "@/components/ui";
import * as Money from "@/domain/shared/money";
import { runAs } from "@/runtime/session";
import { ReportService } from "@/services/report-service";

/**
 * Practice reporting, from aggregates.
 *
 * ## Every figure on this page is computed in the database
 *
 * That is the one thing this slice does differently from every other, and it is
 * deliberate rather than expedient. The precedent bank filters *in the domain*
 * because a firm's bank is tens of rows; the notice feed composes *in a
 * service* because every fact it shows already has an owner. An ageing schedule
 * over three years of fee notes is neither — reading every invoice, line and
 * payment into the application to produce five numbers means the whole billing
 * history crossing the network so one table can be drawn.
 *
 * The cost is that money is now computed twice, in TypeScript and in SQL, which
 * is the arrangement this codebase avoids everywhere else. It is paid for with
 * an integration test that asserts the two agree to the cent against real
 * Postgres, on data chosen to round awkwardly — see `report-repository.ts` for
 * why the rounding position is the part that goes wrong.
 *
 * ## Sections appear according to what the reader may see
 *
 * There is no permission check in this file. A Receptionist gets the caseload
 * breakdown and no figures; a Finance Officer gets everything financial. The
 * service decides, and an absent section simply is not rendered — the same
 * arrangement the billing screen uses for its trust panel.
 */
export default async function ReportsPage() {
  const reports = await runAs(
    Effect.flatMap(ReportService, (service) => service.all()),
  );

  const { ageing, monthly, debtors, earners, practice, totalOutstanding } =
    reports;

  /** The tallest bar, so the chart scales to the data rather than to a guess. */
  const peak = Math.max(
    1,
    ...(monthly ?? []).flatMap((row) => [row.billed, row.collected]),
  );

  return (
    <>
      <h1 className="page-title">Reporting &amp; Analytics</h1>
      <p className="page-subtitle">
        Aggregated in Postgres rather than counted in the browser, as at{" "}
        {reports.asAt.toLocaleDateString("en-KE")}. Every table here exports as
        CSV.
      </p>

      {ageing === undefined ? null : (
        <>
          <div className="stat-grid" style={{ marginBottom: "var(--space-6)" }}>
            <Stat
              label="Outstanding"
              value={Money.format(totalOutstanding ?? Money.zero)}
              tone="accent-2"
              small
            />
            {ageing
              .filter((band) => band.from > 0 && band.outstanding > 0)
              .slice(0, 3)
              .map((band) => (
                <Stat
                  key={band.label}
                  label={band.label}
                  value={Money.format(band.outstanding)}
                  small
                />
              ))}
          </div>

          <SectionTitle>
            Ageing <Export report="ageing" />
          </SectionTitle>
          <p className="dek" style={{ marginBottom: "var(--space-2)" }}>
            By <em>due</em> date, not issue date &mdash; a fee note is not late
            until it is due. Settled fee notes are absent entirely; an overpaid
            one is a credit and does not net off somebody else&rsquo;s debt.
          </p>
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>Band</th>
                  <th>Fee notes</th>
                  <th>Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {ageing.map((band) => (
                  <tr key={band.label}>
                    <td className={band.from > 60 ? "cell-strong" : undefined}>
                      {band.label}
                    </td>
                    <td>{band.count}</td>
                    <td>{Money.format(band.outstanding)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </>
      )}

      {monthly === undefined ? null : (
        <>
          <SectionTitle spaced>
            Billed and collected <Export report="monthly" />
          </SectionTitle>
          <p className="dek" style={{ marginBottom: "var(--space-2)" }}>
            A payment counts in the month it was <em>received</em>, not the
            month the fee note was issued &mdash; which is the difference
            between a collections report and a billing one, and the reason a
            firm runs both.
          </p>
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Billed</th>
                  <th>Collected</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {monthly.map((row) => (
                  <tr key={row.month}>
                    <td className="cell-strong">{row.month}</td>
                    <td>{Money.format(row.billed)}</td>
                    <td>{Money.format(row.collected)}</td>
                    <td style={{ width: "40%" }}>
                      {/*
                        Two bars rather than a chart library. The comparison is
                        the whole message — billed against collected — and it
                        reads at a glance without three hundred kilobytes of
                        JavaScript for six rows.
                      */}
                      <Bar of={row.billed} peak={peak} tone="var(--ink)" />
                      <Bar
                        of={row.collected}
                        peak={peak}
                        tone="var(--color-accent)"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </>
      )}

      {debtors === undefined ? null : (
        <>
          <SectionTitle spaced>
            Who owes the firm <Export report="debtors" />
          </SectionTitle>
          {debtors.length === 0 ? (
            <Empty>Nothing is outstanding.</Empty>
          ) : (
            <TableWrap>
              <table className="table">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Fee notes</th>
                    <th>Outstanding</th>
                    <th>Oldest</th>
                  </tr>
                </thead>
                <tbody>
                  {debtors.map((row) => (
                    <tr key={row.clientId}>
                      <td className="cell-strong">
                        <Link href={`/clients/${row.clientId}`}>
                          {row.clientName}
                        </Link>
                      </td>
                      <td>{row.invoices}</td>
                      <td>{Money.format(row.outstanding)}</td>
                      <td>
                        {row.oldestDueOn.toLocaleDateString("en-KE")}
                        <div className="dek">{row.daysOverdue} days</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </>
      )}

      {earners === undefined ? null : (
        <>
          <SectionTitle spaced>
            Fee earners <Export report="productivity" />
          </SectionTitle>
          <p className="dek" style={{ marginBottom: "var(--space-2)" }}>
            <strong>Utilisation</strong> is billable time as a share of
            everything recorded. <strong>Realisation</strong> is how much of
            that billable value has actually reached a fee note &mdash; low
            realisation is not a productivity problem, it is money sitting
            unbilled.
          </p>
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>Fee earner</th>
                  <th>Hours</th>
                  <th>Utilisation</th>
                  <th>Recorded</th>
                  <th>Realisation</th>
                </tr>
              </thead>
              <tbody>
                {earners.map((row) => (
                  <tr key={row.advocateId}>
                    <td className="cell-strong">{row.name}</td>
                    <td>
                      {row.hours}
                      <div className="dek">{row.billableHours} billable</div>
                    </td>
                    <td>{Math.round(row.utilisation * 100)}%</td>
                    <td>{Money.format(row.recorded)}</td>
                    <td>
                      <span
                        className={
                          row.realisation < 0.5
                            ? "tag tag-outline"
                            : "tag tag-accent"
                        }
                      >
                        {Math.round(row.realisation * 100)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </>
      )}

      <SectionTitle spaced>The caseload</SectionTitle>
      <div className="card-grid">
        <section>
          <h3 className="row-title">By status</h3>
          {practice.byStatus.map((row) => (
            <div className="row row-tight" key={row.status}>
              {row.status} &mdash; {row.count}
            </div>
          ))}
        </section>
        <section>
          <h3 className="row-title">By type</h3>
          {practice.byType.map((row) => (
            <div className="row row-tight" key={row.type}>
              {row.type} &mdash; {row.count}
            </div>
          ))}
        </section>
      </div>
    </>
  );
}

/** A download link beside a section heading. */
function Export({ report }: { report: string }) {
  return (
    <a
      className="btn btn-ghost btn-sm"
      href={`/reports/export/${report}`}
      style={{ marginLeft: "var(--space-3)", fontWeight: 400 }}
    >
      <i className="ph-duotone ph-download-simple" aria-hidden /> CSV
    </a>
  );
}

/**
 * One bar. A `div` with a width, because that is all a bar is.
 *
 * `Math.max(…, 1)` on the width so a non-zero figure is always visible: a month
 * with KES 500 against a peak of two million rounds to nothing, and a bar that
 * disappears reads as no revenue at all.
 */
function Bar({ of, peak, tone }: { of: number; peak: number; tone: string }) {
  return (
    <div
      style={{
        height: 6,
        marginBottom: 3,
        width: of === 0 ? 0 : `${String(Math.max(1, (of / peak) * 100))}%`,
        background: tone,
        borderRadius: 3,
      }}
    />
  );
}
