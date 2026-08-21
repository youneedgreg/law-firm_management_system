import { DateTime, Effect } from "effect";
import type * as Audit from "../domain/audit/entry";
import type * as Matter from "../domain/case/case";
import { may, type NotPermitted } from "../domain/identity/permissions";
import * as Money from "../domain/shared/money";
import { AuditLog } from "./audit-service";
import { BillingService } from "./billing-service";
import { CaseService } from "./case-service";
import { HearingService, type DiaryEntry } from "./hearing-service";
import { type CurrentUser, permitted } from "./policy";
import { type CaseSummary } from "./case-service";
import { ReportService } from "./report-service";
import type { MonthlyFigure } from "./reports";
import type { NotFound, RepositoryFailure } from "./repositories";
import { TaskService } from "./task-service";

/**
 * The dashboard, assembled from services that already exist.
 *
 * ## Composed, not queried
 *
 * Every number on this screen is one another service already computes and has
 * tests for. The unpaid-invoice count is `BillingService`'s idea of unpaid, the
 * open-task count is `TaskService`'s, and the trust balance is the ledger's.
 * Writing six fresh aggregate queries here would have been quicker and would
 * have produced a dashboard that slowly stopped agreeing with the pages it
 * links to — a partner reading "6 unpaid" here and counting five on `/billing`
 * has found a bug in one of them and has no way to tell which.
 *
 * That is a real cost: this does more round trips than a hand-written
 * `SELECT`. It is bounded by the size of a firm and buys the property that
 * matters more, which is that the dashboard cannot disagree with the system.
 *
 * ## One clock reading
 *
 * Shared by every section, for the reason `NoticeService` gives: figures
 * assembled from several `now()`s can show a hearing as upcoming and the task
 * about it as overdue, and somebody will spend ten minutes on the
 * contradiction.
 *
 * ## What each role sees
 *
 * Gated as a whole on `staff:read` — the permission that means "you work
 * here", which no portal user holds. Inside, each band is dropped rather than
 * refused if the caller lacks its permission: a Receptionist gets a dashboard
 * without money on it, not an error page. That asymmetry is deliberate, and it
 * is the same one `ReportService` makes — a *missing* section is honest, while
 * a firm-wide total narrowed to what the reader may see is not smaller but
 * false.
 */

export interface Band {
  readonly activeCases: number;
  /** Absent without `hearing:read` — a Finance Officer holds none. */
  readonly upcomingHearings?: number | undefined;
  /** Absent without `task:read`. */
  readonly openTasks?: number | undefined;
  /** Absent for a caller with no `invoice:read`. */
  readonly unpaidInvoices?: number | undefined;
  readonly collectedThisMonth?: Money.Money | undefined;
  /** Absent without `trust:read`, which is narrower again. */
  readonly trustHeld?: Money.Money | undefined;
}

export interface WorkloadLine {
  readonly advocateName: string;
  readonly count: number;
}

export interface Dashboard {
  readonly band: Band;
  readonly byStatus: readonly {
    readonly status: string;
    readonly count: number;
  }[];
  /** Absent without `invoice:read`. */
  readonly monthly?: readonly MonthlyFigure[] | undefined;
  readonly courtDates: readonly DiaryEntry[];
  readonly workload: readonly WorkloadLine[];
  /** Absent without `audit:read`. */
  readonly activity?: readonly Audit.AuditEntry[] | undefined;
  readonly asAt: Date;
}

/** How many court dates and audit lines the two panels show. */
const COURT_DATES = 4;
const ACTIVITY = 5;

/**
 * The statuses a matter is counted "active" under.
 *
 * Named here rather than inlined, because "active" on a dashboard is a claim
 * about what the firm is working on and it should be possible to find out what
 * it means without reading a filter expression. A matter with a hearing listed
 * is being worked on; one that is New is not yet.
 */
const ACTIVE: ReadonlySet<string> = new Set(["Active", "Hearing Scheduled"]);

/**
 * Turns "you may not see this" into an absent section.
 *
 * **Only `NotPermitted` is caught.** A `RepositoryFailure` still fails the
 * screen, because a dashboard that renders a blank panel when the database is
 * unreachable is a dashboard that lies quietly — and the one thing worse than
 * a home page showing an error is a home page showing zero.
 *
 * The catch is per-source rather than around the whole read, so a Finance
 * Officer loses the court diary and keeps the money, and a Receptionist the
 * reverse. Getting this wrong is what the tests found: `hearings.diary()`
 * refused a Finance Officer and took the entire page with it.
 *
 * Written inline at each call site rather than as a generic wrapper. A helper
 * that took an `Effect<A, E | NotPermitted>` and returned an
 * `Effect<A | undefined, Exclude<E, NotPermitted>>` needs a cast to typecheck,
 * and a cast in the function whose whole job is being careful about which
 * errors are swallowed is precisely the wrong place to put one.
 */
const absent = () => Effect.succeed(undefined);

export class DashboardService extends Effect.Service<DashboardService>()(
  "DashboardService",
  {
    effect: Effect.gen(function* () {
      const cases = yield* CaseService;
      const hearings = yield* HearingService;
      const tasks = yield* TaskService;
      const billing = yield* BillingService;
      const reports = yield* ReportService;
      const audit = yield* AuditLog;

      return {
        /**
         * The whole screen, in one pass.
         *
         * An advocate's band counts **their own** matters and the firm's
         * everything else. That split is not an oversight: "active cases" on an
         * advocate's dashboard means the ones they are carrying, while "cases
         * by status" is a picture of the firm they work at. The prototype
         * scoped by matching the signed-in person's *name* against a string
         * column; this scopes by their advocate id, through the caseload filter
         * the caseload screen already uses.
         */
        home: (): Effect.Effect<
          Dashboard,
          NotPermitted | NotFound | RepositoryFailure,
          CurrentUser
        > =>
          Effect.gen(function* () {
            const principal = yield* permitted("staff:read");
            const asAt = yield* DateTime.nowAsDate;

            const mine =
              principal._tag === "Staff" && principal.role === "Advocate"
                ? principal.advocateId
                : undefined;

            const [everyMatter, ownMatters, diary, work, receivables, figures] =
              yield* Effect.all(
                [
                  cases.caseload(),
                  mine === undefined
                    ? Effect.succeed(undefined)
                    : cases.caseload({ advocateId: mine }),
                  hearings
                    .diary()
                    .pipe(Effect.catchTag("NotPermitted", absent)),
                  tasks
                    .workList()
                    .pipe(Effect.catchTag("NotPermitted", absent)),
                  billing
                    .receivables()
                    .pipe(Effect.catchTag("NotPermitted", absent)),
                  reports.all(),
                ],
                { concurrency: "unbounded" },
              );

            const counted = ownMatters ?? everyMatter;

            /**
             * Collected *this* month, from the report's own monthly series
             * rather than a fresh sum. The reporting page shows the same
             * number in a bar chart; two independent sums of the same payments
             * would eventually disagree by a rounding rule.
             */
            const thisMonth = figures.monthly?.at(-1);

            const band: Band = {
              activeCases: counted.filter((row) =>
                ACTIVE.has(row.matter.status),
              ).length,
              ...(diary === undefined
                ? {}
                : { upcomingHearings: diary.upcoming.length }),
              ...(work === undefined ? {} : { openTasks: work.openCount }),
              ...(receivables === undefined
                ? {}
                : {
                    unpaidInvoices: receivables.invoices.filter(
                      (invoice) => invoice.status !== "Paid",
                    ).length,
                    collectedThisMonth: thisMonth?.collected ?? Money.zero,
                  }),
              ...(receivables?.trustHeld === undefined
                ? {}
                : { trustHeld: receivables.trustHeld }),
            };

            const activity = may(principal, "audit:read")
              ? yield* audit.trail(ACTIVITY)
              : undefined;

            return {
              band,
              byStatus: figures.practice.byStatus,
              ...(figures.monthly === undefined
                ? {}
                : { monthly: figures.monthly }),
              courtDates: diary?.upcoming.slice(0, COURT_DATES) ?? [],
              workload: workloadOf(everyMatter),
              ...(activity === undefined ? {} : { activity }),
              asAt,
            };
          }),
      };
    }),
  },
) {}

/**
 * Open matters per advocate, busiest first.
 *
 * Counted in memory from the caseload that was read anyway, rather than as a
 * `GROUP BY`. One firm's worth of matters is already in hand; a second query
 * would be a second definition of "open" to keep in step with this one.
 */
const workloadOf = (
  caseload: readonly CaseSummary[],
): readonly WorkloadLine[] => {
  const counts = new Map<string, number>();

  for (const row of caseload) {
    if (isClosed(row.matter)) continue;
    counts.set(row.advocateName, (counts.get(row.advocateName) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([advocateName, count]) => ({ advocateName, count }))
    .sort(
      (a, b) =>
        b.count - a.count || a.advocateName.localeCompare(b.advocateName),
    );
};

const isClosed = (matter: Matter.Case) => matter.status === "Closed";
