import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, TestClock } from "effect";
import {
  advocates,
  asAdvocate,
  asFinance,
  asPartner,
  asReceptionist,
  asWanjiku,
  clients,
  courtDates,
  documents,
  invoices,
  matters,
  messages,
  movements,
  sarah,
  tasks,
  timeEntries,
  TODAY,
} from "../../test/fixtures";
import {
  inMemoryAdvocates,
  inMemoryAudit,
  inMemoryBilling,
  inMemoryCases,
  inMemoryClients,
  inMemoryDocuments,
  inMemoryHearings,
  inMemoryMessages,
  inMemoryReports,
  inMemoryTasks,
  inMemoryTime,
  inMemoryTransactor,
} from "../../test/in-memory-repositories";
import type { Principal } from "../domain/identity/principal";
import { AuditLog } from "./audit-service";
import { BillingService } from "./billing-service";
import { CaseService } from "./case-service";
import { DashboardService } from "./dashboard-service";
import { HearingService } from "./hearing-service";
import { CurrentUser } from "./policy";
import { ReportService } from "./report-service";
import { TaskService } from "./task-service";

/**
 * `DashboardService`, which owns no data either.
 *
 * Like `NoticeService`, every figure here is a restatement of something another
 * service already computes, so the tests worth writing are about
 * **composition**: that a band drops rather than errors for a caller who may
 * not see it, that an advocate's counts are their own and the firm's charts are
 * the firm's, and — the one that earns its keep — that the numbers on this
 * screen equal the numbers on the pages it links to.
 *
 * That last one is the whole argument for this service reading other services
 * rather than writing its own aggregates. A dashboard with its own `SELECT`
 * would pass a test asserting "6" and still be wrong, because nothing would
 * check the six against what `/billing` shows.
 */

const billing = inMemoryBilling({ invoices, movements });

const sources = Layer.mergeAll(
  CaseService.Default,
  HearingService.Default,
  TaskService.Default,
  BillingService.Default,
  ReportService.Default,
  AuditLog.Default,
).pipe(
  Layer.provideMerge(AuditLog.Default),
  Layer.provideMerge(
    Layer.mergeAll(
      inMemoryCases(matters),
      inMemoryClients(clients),
      inMemoryAdvocates(advocates),
      inMemoryHearings(courtDates),
      inMemoryTasks(tasks),
      inMemoryMessages(messages),
      inMemoryTime(timeEntries),
      inMemoryDocuments(documents).both,
      inMemoryReports({ matters, invoices, time: timeEntries }),
      billing.both,
      inMemoryAudit().layer,
      inMemoryTransactor(),
    ),
  ),
);

const firm = DashboardService.Default.pipe(Layer.provideMerge(sources));

const homeFor = (principal: Principal) =>
  Effect.flatMap(DashboardService, (service) => service.home()).pipe(
    Effect.provideService(CurrentUser, principal),
  );

/**
 * Runs against the whole layer, not only `DashboardService`.
 *
 * The `R` channel is the merged set on purpose: the tests below reach for
 * `TaskService` and `BillingService` directly, to check the dashboard's figures
 * against the services that own them. Narrowing this to `DashboardService`
 * would have forced those tests to assert literal numbers instead, which is
 * exactly the assertion that cannot catch a dashboard drifting from the pages
 * it links to.
 */
type Firm = Layer.Layer.Success<typeof firm>;

const scenario = <A, E>(body: Effect.Effect<A, E, Firm>) =>
  TestClock.setTime(TODAY).pipe(Effect.andThen(body), Effect.provide(firm));

describe("who may see the dashboard", () => {
  /**
   * Gated on `staff:read` — "you work here" — rather than on `case:read`,
   * which a portal user holds. A client reaching this screen would count the
   * firm's other matters from their own login.
   */
  it.effect("refuses a portal user", () =>
    scenario(
      Effect.gen(function* () {
        const outcome = yield* Effect.flip(homeFor(asWanjiku));

        expect(outcome._tag).toBe("NotPermitted");
      }),
    ),
  );

  it.effect("gives a Receptionist a dashboard", () =>
    scenario(
      Effect.gen(function* () {
        const home = yield* homeFor(asReceptionist);

        expect(home.band.activeCases).toBeGreaterThan(0);
      }),
    ),
  );
});

describe("bands a caller may not see", () => {
  /**
   * **Dropped, not refused.** A Receptionist gets a dashboard without money on
   * it. Refusing the whole screen because one band is out of reach would make
   * the least-privileged role's home page an error, and the alternative —
   * showing them a smaller total — would be worse: a firm-wide figure narrowed
   * to what the reader may see is not smaller, it is false.
   */
  it.effect("leaves the money out for a Receptionist", () =>
    scenario(
      Effect.gen(function* () {
        const home = yield* homeFor(asReceptionist);

        expect(home.band.unpaidInvoices).toBeUndefined();
        expect(home.band.collectedThisMonth).toBeUndefined();
        expect(home.monthly).toBeUndefined();
      }),
    ),
  );

  it.effect("shows the money to a Finance Officer", () =>
    scenario(
      Effect.gen(function* () {
        const home = yield* homeFor(asFinance);

        expect(home.band.unpaidInvoices).toBeDefined();
        expect(home.monthly).toBeDefined();
      }),
    ),
  );

  /**
   * **The failure this suite actually found.**
   *
   * A Finance Officer holds no `hearing:read`, and the first version of this
   * service called `hearings.diary()` unguarded — so the refusal propagated and
   * took the entire dashboard down for the one role that most needs the money
   * band. Each source is now caught on its own: they lose the court diary and
   * keep the fee notes.
   */
  it.effect("leaves the court diary out for a Finance Officer", () =>
    scenario(
      Effect.gen(function* () {
        const home = yield* homeFor(asFinance);

        expect(home.band.upcomingHearings).toBeUndefined();
        expect(home.courtDates).toStrictEqual([]);
        expect(home.band.unpaidInvoices).toBeDefined();
      }),
    ),
  );

  /**
   * And the mirror image, so neither role's dashboard is passing by accident.
   * A Receptionist may read the diary and may not read the money.
   */
  it.effect("keeps the court diary for a Receptionist", () =>
    scenario(
      Effect.gen(function* () {
        const home = yield* homeFor(asReceptionist);

        expect(home.band.upcomingHearings).toBeDefined();
        expect(home.band.unpaidInvoices).toBeUndefined();
      }),
    ),
  );

  /** The practice picture is every staff role's, money or no money. */
  it.effect("shows the caseload breakdown to everybody at the firm", () =>
    scenario(
      Effect.gen(function* () {
        const home = yield* homeFor(asReceptionist);

        expect(home.byStatus.length).toBeGreaterThan(0);
      }),
    ),
  );

  /**
   * The audit trail is narrower than the rest, and the dashboard's "recent
   * activity" panel is the audit trail. An Advocate does not hold `audit:read`.
   */
  it.effect("leaves recent activity out without audit:read", () =>
    scenario(
      Effect.gen(function* () {
        const home = yield* homeFor(asAdvocate);

        expect(home.activity).toBeUndefined();
      }),
    ),
  );

  it.effect("shows recent activity to a partner", () =>
    scenario(
      Effect.gen(function* () {
        const home = yield* homeFor(asPartner);

        expect(home.activity).toBeDefined();
      }),
    ),
  );
});

describe("whose cases are counted", () => {
  /**
   * **An advocate's band is their own matters; the firm's charts are the
   * firm's.**
   *
   * Not an oversight. "Active cases" on an advocate's dashboard means the ones
   * they are carrying, while "cases by status" is a picture of the firm they
   * work at. The prototype scoped by matching the signed-in person's *name*
   * against a string column, which is why this is worth a test at all.
   */
  it.effect("counts an advocate's own matters in the band", () =>
    scenario(
      Effect.gen(function* () {
        const home = yield* homeFor(asAdvocate);

        const hers = matters.filter(
          (matter) =>
            matter.advocateId === sarah.id &&
            (matter.status === "Active" ||
              matter.status === "Hearing Scheduled"),
        ).length;

        expect(home.band.activeCases).toBe(hers);
      }),
    ),
  );

  it.effect("counts the whole firm for a partner", () =>
    scenario(
      Effect.gen(function* () {
        const home = yield* homeFor(asPartner);

        const everyone = matters.filter(
          (matter) =>
            matter.status === "Active" || matter.status === "Hearing Scheduled",
        ).length;

        expect(home.band.activeCases).toBe(everyone);
      }),
    ),
  );

  /** The workload panel is firm-wide even for an advocate. */
  it.effect("gives an advocate the whole firm's workload", () =>
    scenario(
      Effect.gen(function* () {
        const home = yield* homeFor(asAdvocate);

        const named = new Set(home.workload.map((line) => line.advocateName));

        expect(named.size).toBeGreaterThan(1);
      }),
    ),
  );

  it.effect("does not count closed matters as workload", () =>
    scenario(
      Effect.gen(function* () {
        const home = yield* homeFor(asPartner);

        const counted = home.workload.reduce(
          (total, line) => total + line.count,
          0,
        );
        const open = matters.filter(
          (matter) => matter.status !== "Closed",
        ).length;

        expect(counted).toBe(open);
      }),
    ),
  );

  it.effect("puts the busiest advocate first", () =>
    scenario(
      Effect.gen(function* () {
        const home = yield* homeFor(asPartner);
        const counts = home.workload.map((line) => line.count);

        expect(counts).toStrictEqual([...counts].sort((a, b) => b - a));
      }),
    ),
  );
});

describe("agreeing with the pages it links to", () => {
  /**
   * **The tests this service exists to pass.**
   *
   * Each figure is checked against the service that owns it, rather than
   * against a number typed into this file. A dashboard asserting "6" would
   * still be wrong if `/billing` said five; these fail in exactly that case.
   */
  it.effect("counts the same open tasks as the work list", () =>
    scenario(
      Effect.gen(function* () {
        const home = yield* homeFor(asPartner);
        const work = yield* Effect.flatMap(TaskService, (service) =>
          service.workList(),
        ).pipe(Effect.provideService(CurrentUser, asPartner));

        expect(home.band.openTasks).toBe(work.openCount);
      }),
    ),
  );

  it.effect("counts the same upcoming hearings as the court diary", () =>
    scenario(
      Effect.gen(function* () {
        const home = yield* homeFor(asPartner);
        const diary = yield* Effect.flatMap(HearingService, (service) =>
          service.diary(),
        ).pipe(Effect.provideService(CurrentUser, asPartner));

        expect(home.band.upcomingHearings).toBe(diary.upcoming.length);
      }),
    ),
  );

  it.effect("counts the same unpaid fee notes as the billing screen", () =>
    scenario(
      Effect.gen(function* () {
        const home = yield* homeFor(asFinance);
        const receivables = yield* Effect.flatMap(BillingService, (service) =>
          service.receivables(),
        ).pipe(Effect.provideService(CurrentUser, asFinance));

        const unpaid = receivables.invoices.filter(
          (invoice) => invoice.status !== "Paid",
        ).length;

        expect(home.band.unpaidInvoices).toBe(unpaid);
      }),
    ),
  );

  it.effect("holds the same money on trust as the ledger", () =>
    scenario(
      Effect.gen(function* () {
        const home = yield* homeFor(asPartner);
        const receivables = yield* Effect.flatMap(BillingService, (service) =>
          service.receivables(),
        ).pipe(Effect.provideService(CurrentUser, asPartner));

        expect(home.band.trustHeld).toStrictEqual(receivables.trustHeld);
      }),
    ),
  );

  /**
   * The month's collections come from the report's own series rather than a
   * fresh sum, so the figure in the band and the last bar of the chart on
   * `/reports` are the same arithmetic.
   */
  it.effect("collects the same amount as the last month of the chart", () =>
    scenario(
      Effect.gen(function* () {
        const home = yield* homeFor(asFinance);

        expect(home.band.collectedThisMonth).toStrictEqual(
          home.monthly?.at(-1)?.collected,
        );
      }),
    ),
  );
});

describe("the panels", () => {
  it.effect("shows at most four court dates", () =>
    scenario(
      Effect.gen(function* () {
        const home = yield* homeFor(asPartner);

        expect(home.courtDates.length).toBeLessThanOrEqual(4);
      }),
    ),
  );

  /** Upcoming, not past — the panel says "this week", and a past date is not. */
  it.effect("shows only court dates still to come", () =>
    scenario(
      Effect.gen(function* () {
        const home = yield* homeFor(asPartner);

        for (const entry of home.courtDates) {
          expect(entry.hearing.scheduledFor.getTime()).toBeGreaterThanOrEqual(
            home.asAt.getTime(),
          );
        }
      }),
    ),
  );

  it.effect("shows at most five audit lines", () =>
    scenario(
      Effect.gen(function* () {
        const home = yield* homeFor(asPartner);

        expect(home.activity?.length ?? 0).toBeLessThanOrEqual(5);
      }),
    ),
  );
});
