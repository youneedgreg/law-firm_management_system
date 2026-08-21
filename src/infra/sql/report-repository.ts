import { SqlClient } from "@effect/sql";
import { Effect, Layer, Schema } from "effect";
import { AdvocateId, ClientId } from "../../domain/shared/ids";
import * as Money from "../../domain/shared/money";
import {
  type AgeBand,
  type Debtor,
  type EarnerProductivity,
  type MonthlyFigure,
  ReportRepository,
} from "../../services/reports";
import { CalendarDate } from "./columns";
import { reading } from "./resilience";

/**
 * The reporting aggregates, in SQL.
 *
 * ## `line_totals` is the whole file
 *
 * Every money figure here starts from one CTE, and it exists to make a single
 * rule impossible to get wrong:
 *
 * ```sql
 * round(unit_price_cents::numeric * quantity_hundredths / 100)
 * ```
 *
 * **Rounded per line, then summed** — which is what `Billing.lineAmount` does,
 * and what `SUM(unit_price_cents * quantity_hundredths) / 100` does not. The
 * two agree on round numbers and differ by a cent on any line whose quantity
 * leaves a remainder, which is most of them: an hourly rate of KES 18,500 for
 * two hours and twenty minutes is exactly that case.
 *
 * Postgres `round(numeric)` and JavaScript `Math.round` both round half away
 * from zero, and both operands are constrained positive (`quantity_hundredths
 * > 0`, `unit_price_cents >= 0`), so the halfway case agrees too rather than
 * agreeing by luck. `::numeric` and not `::float8` — a float would reintroduce
 * exactly the drift `Money` exists to keep out.
 *
 * `invoice-reports.integration.test.ts` asserts the total these produce equals
 * the domain's, over data chosen to have that remainder.
 */

/**
 * Outstanding per invoice, from the two primitive facts.
 *
 * `LEFT JOIN` on both sides, because an invoice with no payments is the normal
 * case and an inner join would silently drop exactly the unpaid fee notes an
 * ageing report is about. The `DISTINCT` sub-selects rather than a two-way join
 * for the reason every reporting query eventually learns: joining lines *and*
 * payments in one statement multiplies the rows and doubles the money.
 */
const OUTSTANDING = `
  WITH line_totals AS (
    SELECT invoice_id,
           SUM(round(unit_price_cents::numeric * quantity_hundredths / 100))
             AS billed
      FROM invoice_lines
     GROUP BY invoice_id
  ),
  paid_totals AS (
    SELECT invoice_id, SUM(amount_cents) AS paid
      FROM payments
     GROUP BY invoice_id
  ),
  balances AS (
    SELECT i.id,
           i.client_id,
           i.due_on,
           i.issued_on,
           COALESCE(l.billed, 0) AS billed,
           COALESCE(p.paid, 0) AS paid,
           COALESCE(l.billed, 0) - COALESCE(p.paid, 0) AS outstanding
      FROM invoices i
      LEFT JOIN line_totals l ON l.invoice_id = i.id
      LEFT JOIN paid_totals p ON p.invoice_id = i.id
  )
`;

/** `bigint` and `numeric` both arrive as strings from node-postgres. */
const cents = (raw: string | number | null): Money.Money =>
  Money.fromCents(Math.round(Number(raw ?? 0)));

export const ReportRepositoryLive = Layer.effect(
  ReportRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    return ReportRepository.of({
      /**
       * The ageing schedule.
       *
       * Buckets by **due date**, not issue date — a fee note is not late until
       * it is due, and ageing by issue would report every current invoice as
       * thirty days old. Only positive balances count: an overpaid fee note is
       * a credit, and letting it net off against somebody else's debt would
       * understate what the firm is owed.
       */
      ageing: (asAt) =>
        sql<{
          band: string;
          outstanding: string;
          count: string;
        }>`
          ${sql.unsafe(OUTSTANDING)}
          SELECT CASE
                   WHEN due_on >= ${asAt}::date THEN 'Not yet due'
                   WHEN ${asAt}::date - due_on <= 30 THEN '1-30 days'
                   WHEN ${asAt}::date - due_on <= 60 THEN '31-60 days'
                   WHEN ${asAt}::date - due_on <= 90 THEN '61-90 days'
                   ELSE 'Over 90 days'
                 END AS band,
                 SUM(outstanding)::text AS outstanding,
                 count(*)::text AS count
            FROM balances
           WHERE outstanding > 0
           GROUP BY band
        `.pipe(
          Effect.map((rows) => {
            const found = new Map(rows.map((row) => [row.band, row]));

            /**
             * Every band, in order, present or not.
             *
             * A `GROUP BY` returns only the buckets with rows in them, and an
             * ageing schedule with the "over 90 days" line missing reads as
             * though nothing is that old rather than as though the query said
             * nothing about it. The order is fixed here rather than sorted in
             * SQL, because it is an order of *severity* and no column
             * expresses it.
             */
            return BANDS.map(({ label, from }): AgeBand => {
              const row = found.get(label);
              return {
                label,
                from,
                outstanding: cents(row?.outstanding ?? 0),
                count: Number(row?.count ?? 0),
              };
            });
          }),
          reading("ReportRepository.ageing"),
        ),

      /**
       * Billed and collected by month.
       *
       * Two separate aggregates unioned rather than one join, for the reason
       * above: an invoice with three lines and two payments joined both ways
       * produces six rows and counts everything three times over.
       *
       * `generate_series` fills the gaps — a month in which the firm issued
       * nothing is a fact worth showing, and a chart that simply omitted it
       * would draw a straight line across the hole.
       */
      monthly: (months, asAt) =>
        sql<{ month: string; billed: string; collected: string }>`
          ${sql.unsafe(OUTSTANDING)},
          span AS (
            SELECT generate_series(
              date_trunc('month', ${asAt}::date) - make_interval(months => ${months - 1}),
              date_trunc('month', ${asAt}::date),
              '1 month'
            ) AS month
          ),
          billed_by_month AS (
            SELECT date_trunc('month', issued_on) AS month, SUM(billed) AS total
              FROM balances
             GROUP BY 1
          ),
          collected_by_month AS (
            SELECT date_trunc('month', received_on) AS month,
                   SUM(amount_cents) AS total
              FROM payments
             GROUP BY 1
          )
          SELECT to_char(s.month, 'YYYY-MM') AS month,
                 COALESCE(b.total, 0)::text AS billed,
                 COALESCE(c.total, 0)::text AS collected
            FROM span s
            LEFT JOIN billed_by_month b ON b.month = s.month
            LEFT JOIN collected_by_month c ON c.month = s.month
           ORDER BY s.month
        `.pipe(
          Effect.map((rows) =>
            rows.map((row): MonthlyFigure => ({
              month: row.month,
              billed: cents(row.billed),
              collected: cents(row.collected),
            })),
          ),
          reading("ReportRepository.monthly"),
        ),

      /**
       * What each fee-earner recorded, and how much of it reached a fee note.
       *
       * The value of recorded time is `minutes ÷ 60 × rate`, rounded once per
       * entry — the same shape as a line total, and wrong in the same way if
       * the rounding is moved outside the sum.
       *
       * `FILTER (WHERE …)` rather than `CASE WHEN` inside the aggregate: it is
       * the same result and it says what it means, which matters in a query
       * with four sums that differ only by their condition.
       */
      productivity: () =>
        /*
          Aliases are single words or camelCase because `PgLive` transforms
          result column names — `advocate_id` arrives as `advocateId`, and a
          type declaring the snake_case name compiles happily and reads
          `undefined` at runtime. That cost a debugging round here, so the
          aliases now say what actually arrives.
        */
        sql<{
          advocateId: string;
          minutes: string;
          billableMinutes: string;
          recorded: string;
          billed: string;
        }>`
          SELECT advocate_id,
                 COALESCE(SUM(minutes), 0)::text AS minutes,
                 COALESCE(SUM(minutes) FILTER (WHERE billable), 0)::text
                   AS "billableMinutes",
                 COALESCE(
                   SUM(round(minutes::numeric / 60 * hourly_rate_cents))
                     FILTER (WHERE billable),
                   0
                 )::text AS recorded,
                 COALESCE(
                   SUM(round(minutes::numeric / 60 * hourly_rate_cents))
                     FILTER (WHERE billable AND invoice_id IS NOT NULL),
                   0
                 )::text AS billed
            FROM time_entries
           GROUP BY advocate_id
        `.pipe(
          Effect.map((rows) =>
            rows.map((row): EarnerProductivity => ({
              advocateId: Schema.decodeSync(AdvocateId)(row.advocateId),
              minutes: Number(row.minutes),
              billableMinutes: Number(row.billableMinutes),
              recorded: cents(row.recorded),
              billed: cents(row.billed),
            })),
          ),
          reading("ReportRepository.productivity"),
        ),

      /** Who owes the firm money, most first. */
      debtors: () =>
        sql<{
          clientId: string;
          outstanding: string;
          oldestDueOn: Date;
          invoices: string;
        }>`
          ${sql.unsafe(OUTSTANDING)}
          SELECT client_id,
                 SUM(outstanding)::text AS outstanding,
                 min(due_on) AS "oldestDueOn",
                 count(*)::text AS invoices
            FROM balances
           WHERE outstanding > 0
           GROUP BY client_id
           ORDER BY SUM(outstanding) DESC
        `.pipe(
          Effect.map((rows) =>
            rows.map((row): Debtor => ({
              clientId: Schema.decodeSync(ClientId)(row.clientId),
              outstanding: cents(row.outstanding),
              /**
               * Through `CalendarDate`, not `new Date(…)`.
               *
               * This said `new Date(row.oldestDueOn)` and was **off by one
               * day in the CSV export**: node-postgres parses a `date` into a
               * `Date` at *local* midnight, so 20 July in Nairobi is
               * 19 July 21:00 UTC, and `toISOString().slice(0, 10)` then
               * writes the nineteenth. The screen looked right because
               * `toLocaleDateString` reads the same local fields the driver
               * wrote.
               *
               * `CalendarDate` is the module that exists for exactly this,
               * and the bug was reaching around it. Found by comparing an
               * exported file against the page it came from.
               */
              oldestDueOn: Schema.decodeSync(CalendarDate)(row.oldestDueOn),
              invoices: Number(row.invoices),
            })),
          ),
          reading("ReportRepository.debtors"),
        ),

      mattersByStatus: () =>
        sql<{ status: string; count: string }>`
          SELECT status::text AS status, count(*)::text AS count
            FROM cases
           GROUP BY status
           ORDER BY count(*) DESC
        `.pipe(
          Effect.map((rows) =>
            rows.map((row) => ({
              status: row.status,
              count: Number(row.count),
            })),
          ),
          reading("ReportRepository.mattersByStatus"),
        ),

      mattersByType: () =>
        sql<{ type: string; count: string }>`
          SELECT type::text AS type, count(*)::text AS count
            FROM cases
           GROUP BY type
           ORDER BY count(*) DESC
        `.pipe(
          Effect.map((rows) =>
            rows.map((row) => ({ type: row.type, count: Number(row.count) })),
          ),
          reading("ReportRepository.mattersByType"),
        ),
    });
  }),
);

/**
 * The bands, in order of severity.
 *
 * Thirty-day steps because that is how a firm's terms are written and how its
 * accountant reads a schedule. "Over 90 days" is the one that matters — past it
 * a fee note is usually written off or sued for, and lumping it into "61+"
 * hides the distinction between late and lost.
 */
const BANDS: readonly { readonly label: string; readonly from: number }[] = [
  { label: "Not yet due", from: 0 },
  { label: "1-30 days", from: 1 },
  { label: "31-60 days", from: 31 },
  { label: "61-90 days", from: 61 },
  { label: "Over 90 days", from: 91 },
];
