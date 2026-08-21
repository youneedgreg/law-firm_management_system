import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, TestClock } from "effect";
import {
  advocates,
  asFinance,
  asPartner,
  asReceptionist,
  asWanjiku,
  clients,
  invoices,
  matters,
  timeEntries,
  TODAY,
} from "../../test/fixtures";
import {
  inMemoryAdvocates,
  inMemoryClients,
  inMemoryReports,
} from "../../test/in-memory-repositories";
import * as Billing from "../domain/billing/invoice";
import type { Principal } from "../domain/identity/principal";
import { CurrentUser } from "./policy";
import { ReportService } from "./report-service";

/**
 * `ReportService`, over aggregates computed from the same fixtures.
 *
 * The fake computes them with the domain's own functions rather than
 * reimplementing the SQL — so these tests check that the *service* assembles
 * and gates a report correctly, and `report-repository.integration.test.ts`
 * separately checks that the SQL agrees with those same domain functions
 * against real Postgres. Two hand-written aggregates agreeing with each other
 * would prove nothing.
 */

const firm = ReportService.Default.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      inMemoryReports({ invoices, time: timeEntries, matters }),
      inMemoryClients(clients),
      inMemoryAdvocates(advocates),
    ),
  ),
);

const reportsFor = (principal: Principal) =>
  Effect.flatMap(ReportService, (service) => service.all()).pipe(
    Effect.provideService(CurrentUser, principal),
  );

const scenario = <A, E>(body: Effect.Effect<A, E, ReportService>) =>
  TestClock.setTime(TODAY).pipe(Effect.andThen(body), Effect.provide(firm));

describe("who may see what", () => {
  it.effect("gives a partner every section", () =>
    scenario(
      Effect.gen(function* () {
        const reports = yield* reportsFor(asPartner);

        expect(reports.ageing).toBeDefined();
        expect(reports.debtors).toBeDefined();
        expect(reports.monthly).toBeDefined();
        expect(reports.earners).toBeDefined();
        expect(reports.practice.byStatus.length).toBeGreaterThan(0);
      }),
    ),
  );

  /**
   * **The gating this service exists to get right.**
   *
   * A Receptionist holds `staff:read` and `case:read` and not one permission
   * touching money or time. They get the caseload breakdown and nothing else —
   * served, rather than refused, because a page they are mostly entitled to is
   * better than a 403.
   */
  it.effect("gives a Receptionist the caseload and no figures", () =>
    scenario(
      Effect.gen(function* () {
        const reports = yield* reportsFor(asReceptionist);

        expect(reports.practice.byStatus.length).toBeGreaterThan(0);
        expect(reports.ageing).toBeUndefined();
        expect(reports.debtors).toBeUndefined();
        expect(reports.monthly).toBeUndefined();
        expect(reports.earners).toBeUndefined();
      }),
    ),
  );

  /** Finance holds `invoice:read` and `time:read`, so both halves appear. */
  it.effect("gives a Finance Officer the money and the time", () =>
    scenario(
      Effect.gen(function* () {
        const reports = yield* reportsFor(asFinance);

        expect(reports.ageing).toBeDefined();
        expect(reports.earners).toBeDefined();
      }),
    ),
  );

  /**
   * **Refused outright, not narrowed.**
   *
   * `staff:read` is the gate, and it is the right one: `case:read` would have
   * been the intuitive choice and a portal user holds it. Narrowing a
   * firm-wide total to one client does not produce a smaller report, it
   * produces a false one.
   */
  it.effect("refuses a portal user entirely", () =>
    scenario(
      Effect.gen(function* () {
        const refused = yield* Effect.flip(reportsFor(asWanjiku));

        expect(refused._tag).toBe("NotPermitted");
      }),
    ),
  );
});

describe("the figures", () => {
  it.effect("returns every ageing band, in order of severity", () =>
    scenario(
      Effect.gen(function* () {
        const reports = yield* reportsFor(asPartner);

        expect(reports.ageing?.map((band) => band.label)).toStrictEqual([
          "Not yet due",
          "1-30 days",
          "31-60 days",
          "61-90 days",
          "Over 90 days",
        ]);
      }),
    ),
  );

  /**
   * The headline figure is the sum of the bands, so a reader adding the column
   * up gets the number at the top. A separately-derived total would eventually
   * disagree with the table beneath it, which is the one thing a financial
   * report may not do.
   */
  it.effect("makes the headline the sum of the bands", () =>
    scenario(
      Effect.gen(function* () {
        const reports = yield* reportsFor(asPartner);
        const summed = (reports.ageing ?? []).reduce(
          (total, band) => total + band.outstanding,
          0,
        );

        expect(reports.totalOutstanding).toBe(summed);
      }),
    ),
  );

  it.effect("agrees with the domain about what is outstanding", () =>
    scenario(
      Effect.gen(function* () {
        const reports = yield* reportsFor(asPartner);

        const fromDomain = invoices
          .map(Billing.outstanding)
          .filter((amount) => amount > 0)
          .reduce((total, amount) => total + amount, 0);

        expect(reports.totalOutstanding).toBe(fromDomain);
      }),
    ),
  );

  it.effect("puts the largest debtor first", () =>
    scenario(
      Effect.gen(function* () {
        const reports = yield* reportsFor(asPartner);
        const owed = (reports.debtors ?? []).map((row) => row.outstanding);

        expect(owed).toStrictEqual([...owed].sort((a, b) => b - a));
      }),
    ),
  );

  it.effect("counts the months asked for, oldest first", () =>
    scenario(
      Effect.gen(function* () {
        const reports = yield* reportsFor(asPartner);
        const months = (reports.monthly ?? []).map((row) => row.month);

        expect(months).toHaveLength(6);
        expect(months).toStrictEqual([...months].sort());
      }),
    ),
  );

  /**
   * Utilisation and realisation are shares, and a fee-earner who has recorded
   * nothing divides by zero. `NaN` renders as "NaN%" on a report, which is how
   * a reader stops trusting the whole page.
   */
  it.effect("never reports NaN for somebody who recorded nothing", () =>
    scenario(
      Effect.gen(function* () {
        const reports = yield* reportsFor(asPartner);

        for (const earner of reports.earners ?? []) {
          expect(Number.isFinite(earner.utilisation)).toBe(true);
          expect(Number.isFinite(earner.realisation)).toBe(true);
          expect(earner.utilisation).toBeGreaterThanOrEqual(0);
          expect(earner.realisation).toBeGreaterThanOrEqual(0);
        }
      }),
    ),
  );

  it.effect("resolves fee-earner and client names", () =>
    scenario(
      Effect.gen(function* () {
        const reports = yield* reportsFor(asPartner);

        for (const earner of reports.earners ?? []) {
          expect(earner.name).not.toBe("Unknown");
        }
        for (const debtor of reports.debtors ?? []) {
          expect(debtor.clientName).not.toBe("Unknown client");
        }
      }),
    ),
  );

  /**
   * Realisation is billed over recorded, so it cannot exceed one: a fee-earner
   * cannot have billed more than they recorded. A value above 100% would mean
   * the two sums were counting different things.
   */
  it.effect("never realises more than was recorded", () =>
    scenario(
      Effect.gen(function* () {
        const reports = yield* reportsFor(asPartner);

        for (const earner of reports.earners ?? []) {
          expect(earner.realisation).toBeLessThanOrEqual(1);
          expect(earner.billed).toBeLessThanOrEqual(earner.recorded);
        }
      }),
    ),
  );

  it.effect("reports every recorded hour, billable or not", () =>
    scenario(
      Effect.gen(function* () {
        const reports = yield* reportsFor(asPartner);
        const total = (reports.earners ?? []).reduce(
          (sum, earner) => sum + earner.hours,
          0,
        );

        const fromFixtures =
          timeEntries.reduce((sum, entry) => sum + entry.minutes, 0) / 60;

        expect(total).toBeCloseTo(fromFixtures, 1);
      }),
    ),
  );
});
