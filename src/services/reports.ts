import { Context, type Effect } from "effect";
import type * as Money from "../domain/shared/money";
import type { AdvocateId, ClientId } from "../domain/shared/ids";
import type { RepositoryFailure } from "./repositories";

/**
 * Reporting reads, and the one place in this system where aggregation belongs
 * in the database.
 *
 * ## Why here and not in the domain
 *
 * Two other slices deliberately went the other way, and the contrast is the
 * argument. The precedent bank filters and searches **in the domain**, over the
 * whole list, because a firm's bank is tens of entries and pushing the rule
 * into SQL would put "is this still good law" in two places. The notice feed
 * composes **in a service**, from other services, because every fact it shows
 * already has an owner.
 *
 * Reports are different in kind. An ageing schedule over three years of fee
 * notes reads every invoice, every line and every payment to produce five
 * numbers — and reading them into the application to add them up means the
 * whole billing history crossing the network so that one row can be rendered.
 * `GROUP BY` is what a database is for, and this is the read that needs it.
 *
 * ## The risk that comes with it, and what is done about it
 *
 * **Money is now computed in two places.** `Billing.total` sums `lineAmount`
 * over the lines in TypeScript; these queries sum the same thing in SQL. Two
 * implementations of one rule is exactly the arrangement this codebase avoids
 * everywhere else, and it is accepted here only because the alternative is
 * worse — with one mitigation that is not optional:
 *
 * **The rounding must happen per line, not per invoice.** `lineAmount` is
 * `round(unitPriceCents × quantityHundredths ÷ 100)`, applied to each line
 * before summing. A query that summed first and rounded once would differ from
 * the domain by a cent whenever a line has a fractional remainder — invisible
 * on round numbers, and wrong on every hourly rate that is not a multiple of
 * a hundred. `invoice-reports.integration.test.ts` asserts the two agree
 * against real Postgres, on data chosen to have that remainder.
 */

/** One bucket of the ageing schedule. */
export interface AgeBand {
  readonly label: string;
  /** Days past due at the lower edge. `0` is the not-yet-due bucket. */
  readonly from: number;
  readonly outstanding: Money.Money;
  readonly count: number;
}

/** Money in and money out, by calendar month. */
export interface MonthlyFigure {
  /** `2026-08`, so it sorts and needs no locale to compare. */
  readonly month: string;
  readonly billed: Money.Money;
  readonly collected: Money.Money;
}

/** What one fee-earner recorded, and what became of it. */
export interface EarnerProductivity {
  readonly advocateId: AdvocateId;
  readonly minutes: number;
  readonly billableMinutes: number;
  /** Billable value recorded, whether or not it has been invoiced. */
  readonly recorded: Money.Money;
  /** The part already carried onto a fee note. */
  readonly billed: Money.Money;
}

/** A client's outstanding position, for the debtors list. */
export interface Debtor {
  readonly clientId: ClientId;
  readonly outstanding: Money.Money;
  readonly oldestDueOn: Date;
  readonly invoices: number;
}

/**
 * Every figure a report needs, as aggregates.
 *
 * Each returns *ids and numbers only* — no names. Resolving those is the
 * service's job, and keeping it out of the SQL means these queries do not join
 * four tables to produce five rows, and cannot quietly become the place where
 * a portal user's scope was forgotten.
 */
export interface ReportRepository {
  /** Outstanding fee notes, bucketed by how long they have been overdue. */
  readonly ageing: (
    asAt: Date,
  ) => Effect.Effect<readonly AgeBand[], RepositoryFailure>;

  /** Billed and collected per month, oldest first. */
  readonly monthly: (
    months: number,
    asAt: Date,
  ) => Effect.Effect<readonly MonthlyFigure[], RepositoryFailure>;

  readonly productivity: () => Effect.Effect<
    readonly EarnerProductivity[],
    RepositoryFailure
  >;

  readonly debtors: () => Effect.Effect<readonly Debtor[], RepositoryFailure>;

  /** Open matters by status, for the caseload breakdown. */
  readonly mattersByStatus: () => Effect.Effect<
    readonly { readonly status: string; readonly count: number }[],
    RepositoryFailure
  >;

  readonly mattersByType: () => Effect.Effect<
    readonly { readonly type: string; readonly count: number }[],
    RepositoryFailure
  >;
}

export const ReportRepository =
  Context.GenericTag<ReportRepository>("ReportRepository");
