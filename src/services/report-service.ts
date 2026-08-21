import { DateTime, Effect } from "effect";
import { may, type NotPermitted } from "../domain/identity/permissions";
import type { AdvocateId, ClientId } from "../domain/shared/ids";
import * as Money from "../domain/shared/money";
import { type CurrentUser, permitted } from "./policy";
import {
  AdvocateRepository,
  ClientRepository,
  type RepositoryFailure,
} from "./repositories";
import { type AgeBand, type MonthlyFigure, ReportRepository } from "./reports";

/**
 * Practice reporting.
 *
 * ## Every figure here is an aggregate, and none of it is scoped
 *
 * That is the unusual thing about this service and it needs stating rather than
 * assuming. Every other read in this system narrows to what the caller may see;
 * a report deliberately does not, because a firm-wide total narrowed to one
 * client is not a smaller report, it is a *wrong* one — an ageing schedule
 * showing a third of what is owed is worse than no schedule.
 *
 * So the answer is a permission rather than a scope: `invoice:read` for money,
 * `time:read` for productivity, and **a portal user reaches none of it**. There
 * is no per-client variant, and if there is ever a client-facing statement it
 * will be a different operation with a different name — not this one with a
 * `WHERE` bolted on, which is how a report becomes the endpoint that leaks.
 *
 * ## Two permissions, two halves, one page
 *
 * A Finance Officer holds `invoice:read` and only `time:read`; an Advocate
 * holds `time:read` and `invoice:read` but not `trust:read`. Rather than
 * refusing the whole page to anybody missing one, each section is gated
 * separately and absent sections simply do not appear — the same arrangement
 * `BillingService.receivables` uses for the trust panel, and for the same
 * reason: a screen served with one section fewer beats a 403 on a page the
 * reader is mostly entitled to.
 */

// ── What the screen reads ─────────────────────────────────────────────────

export interface DebtorLine {
  readonly clientId: ClientId;
  readonly clientName: string;
  readonly outstanding: Money.Money;
  readonly oldestDueOn: Date;
  readonly daysOverdue: number;
  readonly invoices: number;
}

export interface EarnerLine {
  readonly advocateId: AdvocateId;
  readonly name: string;
  readonly hours: number;
  readonly billableHours: number;
  /** Billable time as a share of everything recorded. */
  readonly utilisation: number;
  readonly recorded: Money.Money;
  readonly billed: Money.Money;
  /**
   * Billed as a share of billable value recorded.
   *
   * A firm's *realisation* rate, and the number that says how much recorded
   * work is actually turning into fee notes. Low realisation is not a
   * productivity problem — it is work sitting unbilled, which is the same money
   * with a longer wait.
   */
  readonly realisation: number;
}

export interface Practice {
  readonly byStatus: readonly {
    readonly status: string;
    readonly count: number;
  }[];
  readonly byType: readonly { readonly type: string; readonly count: number }[];
}

export interface Reports {
  readonly asAt: Date;
  /** Absent when the caller may not read fee notes. */
  readonly ageing?: readonly AgeBand[] | undefined;
  readonly monthly?: readonly MonthlyFigure[] | undefined;
  readonly debtors?: readonly DebtorLine[] | undefined;
  readonly totalOutstanding?: Money.Money | undefined;
  /** Absent when the caller may not read recorded time. */
  readonly earners?: readonly EarnerLine[] | undefined;
  /** The caseload breakdown. Every staff role may see it. */
  readonly practice: Practice;
}

/** How far back the monthly chart reaches. */
const MONTHS = 6;

const whole = (from: Date, to: Date) =>
  Math.max(
    0,
    Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)),
  );

const hours = (minutes: number) => Math.round((minutes / 60) * 10) / 10;

/** A share, or zero — never `NaN`, which renders as "NaN%" on a report. */
const share = (part: number, whole_: number) =>
  whole_ === 0 ? 0 : part / whole_;

export class ReportService extends Effect.Service<ReportService>()(
  "ReportService",
  {
    effect: Effect.gen(function* () {
      const reports = yield* ReportRepository;
      const clients = yield* ClientRepository;
      const advocates = yield* AdvocateRepository;

      return {
        /**
         * The whole reporting page, in one read.
         *
         * One clock reading shared by every section — an ageing schedule that
         * bucketed against one `now()` while the monthly chart ended at
         * another would disagree at a month boundary, on the one day of the
         * month a partner is most likely to be looking.
         */
        all: (): Effect.Effect<
          Reports,
          NotPermitted | RepositoryFailure,
          CurrentUser
        > =>
          Effect.gen(function* () {
            /**
             * Gated on `staff:read`, which is not obvious and is the right
             * one: it is the permission that means "you work here", every
             * staff role holds it, and no portal user does.
             *
             * `case:read` would have been the intuitive choice and is wrong —
             * a portal user holds it. And a *scope* check would be wrong in a
             * different way: narrowing a firm-wide total to one client does
             * not produce a smaller report, it produces a false one. An ageing
             * schedule showing a third of what is owed is worse than none, so
             * this refuses rather than filters.
             *
             * "Four matters at Hearing Scheduled" is a fact about the firm.
             * A client counting the firm's other matters from their own portal
             * is a disclosure, however small the number.
             */
            const principal = yield* permitted("staff:read");
            const asAt = yield* DateTime.nowAsDate;

            const mayReadMoney = may(principal, "invoice:read");
            const mayReadTime = may(principal, "time:read");

            const [byStatus, byType] = yield* Effect.all(
              [reports.mattersByStatus(), reports.mattersByType()],
              { concurrency: "unbounded" },
            );

            const practice: Practice = { byStatus, byType };

            const money = mayReadMoney
              ? yield* Effect.all(
                  [
                    reports.ageing(asAt),
                    reports.monthly(MONTHS, asAt),
                    reports.debtors(),
                    clients.all(),
                  ],
                  { concurrency: "unbounded" },
                )
              : undefined;

            const time = mayReadTime
              ? yield* Effect.all([reports.productivity(), advocates.all()], {
                  concurrency: "unbounded",
                })
              : undefined;

            const debtors =
              money === undefined
                ? undefined
                : (() => {
                    const [, , rows, everyClient] = money;
                    const names = new Map(
                      everyClient.map((client) => [client.id, client.name]),
                    );

                    return rows.map((row): DebtorLine => ({
                      clientId: row.clientId,
                      clientName: names.get(row.clientId) ?? "Unknown client",
                      outstanding: row.outstanding,
                      oldestDueOn: row.oldestDueOn,
                      daysOverdue: whole(row.oldestDueOn, asAt),
                      invoices: row.invoices,
                    }));
                  })();

            const earners =
              time === undefined
                ? undefined
                : (() => {
                    const [rows, everyAdvocate] = time;
                    const names = new Map(
                      everyAdvocate.map((advocate) => [
                        advocate.id,
                        advocate.name,
                      ]),
                    );

                    return rows
                      .map((row): EarnerLine => ({
                        advocateId: row.advocateId,
                        name: names.get(row.advocateId) ?? "Unknown",
                        hours: hours(row.minutes),
                        billableHours: hours(row.billableMinutes),
                        utilisation: share(row.billableMinutes, row.minutes),
                        recorded: row.recorded,
                        billed: row.billed,
                        realisation: share(row.billed, row.recorded),
                      }))
                      .sort((a, b) => b.recorded - a.recorded);
                  })();

            return {
              asAt,
              practice,
              ...(money === undefined
                ? {}
                : {
                    ageing: money[0],
                    monthly: money[1],
                    debtors,
                    totalOutstanding: Money.sum(
                      money[0].map((band) => band.outstanding),
                    ),
                  }),
              ...(earners === undefined ? {} : { earners }),
            };
          }),
      };
    }),
  },
) {}
