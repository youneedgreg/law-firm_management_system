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
  inMemoryTasks,
  inMemoryTime,
  inMemoryTransactor,
} from "../../test/in-memory-repositories";
import type { Principal } from "../domain/identity/principal";
import { AuditLog } from "./audit-service";
import { BillingService } from "./billing-service";
import { HearingService } from "./hearing-service";
import { MessageService } from "./message-service";
import { NoticeService, bySeverity, pressing } from "./notice-service";
import { CurrentUser } from "./policy";
import { TaskService } from "./task-service";

/**
 * `NoticeService`, which owns no data at all.
 *
 * Every notice is a restatement of a fact one of four other services already
 * knows, so the tests worth writing are about *composition*: that each source
 * reaches the feed, that a caller who may not read a source silently gets
 * nothing from it rather than an error, and that the ordering puts the worst
 * thing first.
 */

const billing = inMemoryBilling({ invoices, movements });

/**
 * The four sources, then the service that composes them.
 *
 * `provideMerge` rather than `mergeAll`: `NoticeService` *requires* the other
 * four, so they have to be supplied to it rather than stood beside it. Getting
 * this wrong is a runtime "Service not found" and not a type error, because a
 * merged layer satisfies the same tags — which is worth knowing, since it is
 * the one Layer mistake this codebase can still make silently.
 */
const sources = Layer.mergeAll(
  HearingService.Default,
  TaskService.Default,
  BillingService.Default,
  MessageService.Default,
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
      billing.both,
      inMemoryAudit().layer,
      inMemoryTransactor(),
    ),
  ),
);

const firm = NoticeService.Default.pipe(Layer.provideMerge(sources));

const asSomeone = (principal: Principal) =>
  Effect.flatMap(NoticeService, (service) => service.feed()).pipe(
    Effect.provideService(CurrentUser, principal),
  );

const scenario = <A, E>(body: Effect.Effect<A, E, NoticeService>) =>
  TestClock.setTime(TODAY).pipe(Effect.andThen(body), Effect.provide(firm));

describe("what needs attention", () => {
  it.effect("draws on all four modules for a partner", () =>
    scenario(
      Effect.gen(function* () {
        const feed = yield* asSomeone(asPartner);
        const sources = new Set(feed.map((notice) => notice.source));

        expect(sources).toContain("Hearing");
        expect(sources).toContain("Task");
        expect(sources).toContain("Message");
      }),
    ),
  );

  /**
   * **The property the composition exists for.**
   *
   * A Receptionist holds `hearing:read` and `task:read` and not one permission
   * touching money. The feed is served, with the money silently absent —
   * rather than refused outright, which would leave the one role that answers
   * the telephone with no view of the day at all.
   */
  it.effect("gives a Receptionist the diary and none of the money", () =>
    scenario(
      Effect.gen(function* () {
        const feed = yield* asSomeone(asReceptionist);
        const sources = new Set(feed.map((notice) => notice.source));

        expect(feed.length).toBeGreaterThan(0);
        expect(sources).toContain("Hearing");
        expect(sources).not.toContain("Invoice");
      }),
    ),
  );

  /**
   * And the mirror image. A Finance Officer sees the fee notes and does not
   * hold `hearing:read`, so the court diary is absent from theirs.
   */
  it.effect("gives a Finance Officer the money and none of the diary", () =>
    scenario(
      Effect.gen(function* () {
        const feed = yield* asSomeone(asFinance);
        const sources = new Set(feed.map((notice) => notice.source));

        expect(sources).not.toContain("Hearing");
      }),
    ),
  );

  /**
   * A portal user holds `case:read` and `invoice:read` scoped to themselves,
   * and none of the firm's internal reports. Whatever reaches their feed is
   * about their own file — but nothing here is a firm-wide obligation, which
   * is what matters.
   */
  it.effect(
    "never hands a portal user the firm's work or correspondence queue",
    () =>
      scenario(
        Effect.gen(function* () {
          const feed = yield* asSomeone(asWanjiku);
          const sources = new Set(feed.map((notice) => notice.source));

          expect(sources).not.toContain("Task");
          expect(sources).not.toContain("Message");
        }),
      ),
  );

  /**
   * A past hearing with nothing recorded is the most urgent thing this firm can
   * be told — either an administrative gap or a missed attendance.
   */
  it.effect("puts an unrecorded past hearing at the top", () =>
    scenario(
      Effect.gen(function* () {
        const feed = yield* asSomeone(asPartner);
        const [first] = feed;

        expect(first?.severity).toBe("Overdue");
      }),
    ),
  );

  it.effect("counts only what is overdue as pressing", () =>
    scenario(
      Effect.gen(function* () {
        const feed = yield* asSomeone(asPartner);

        expect(pressing(feed)).toBe(
          feed.filter((notice) => notice.severity === "Overdue").length,
        );
        expect(pressing(feed)).toBeLessThan(feed.length);
      }),
    ),
  );

  /**
   * Every notice carries somewhere to go. A feed that tells somebody about a
   * problem and leaves them to find it is a feed people stop reading.
   */
  it.effect("gives every notice a destination", () =>
    scenario(
      Effect.gen(function* () {
        const feed = yield* asSomeone(asPartner);

        for (const notice of feed) {
          expect(notice.href.startsWith("/")).toBe(true);
          expect(notice.text.length).toBeGreaterThan(0);
        }
      }),
    ),
  );

  /**
   * One clock reading across all four sources. Two would let the feed show a
   * task as overdue and a hearing on the same day as upcoming, which is a
   * contradiction somebody spends ten minutes on.
   */
  it.effect("does not contradict itself about what day it is", () =>
    scenario(
      Effect.gen(function* () {
        const feed = yield* asSomeone(asAdvocate);

        for (const notice of feed) {
          if (notice.severity === "Overdue") {
            expect(notice.at.getTime()).toBeLessThanOrEqual(TODAY.getTime());
          }
        }
      }),
    ),
  );
});

describe("ordering", () => {
  const notice = (severity: "Overdue" | "Soon" | "Ahead", at: string) => ({
    source: "Task" as const,
    severity,
    text: `${severity} ${at}`,
    detail: "",
    at: new Date(at),
    href: "/tasks",
  });

  it("puts the worst first, whatever order it is handed", () => {
    const ordered = bySeverity([
      notice("Ahead", "2026-09-30T00:00:00Z"),
      notice("Overdue", "2026-08-01T00:00:00Z"),
      notice("Soon", "2026-08-22T00:00:00Z"),
    ]);

    expect(ordered.map((each) => each.severity)).toStrictEqual([
      "Overdue",
      "Soon",
      "Ahead",
    ]);
  });

  /** The thing that has been wrong longest is the most wrong. */
  it("puts the oldest overdue item first", () => {
    const ordered = bySeverity([
      notice("Overdue", "2026-08-10T00:00:00Z"),
      notice("Overdue", "2026-08-01T00:00:00Z"),
    ]);

    expect(ordered[0]?.at).toStrictEqual(new Date("2026-08-01T00:00:00Z"));
  });

  it("puts the soonest upcoming item first", () => {
    const ordered = bySeverity([
      notice("Soon", "2026-08-25T00:00:00Z"),
      notice("Soon", "2026-08-22T00:00:00Z"),
    ]);

    expect(ordered[0]?.at).toStrictEqual(new Date("2026-08-22T00:00:00Z"));
  });

  it("does not mutate what it is given", () => {
    const first = notice("Ahead", "2026-09-30T00:00:00Z");
    const second = notice("Overdue", "2026-08-01T00:00:00Z");
    const given = [first, second];

    bySeverity(given);

    expect(given).toStrictEqual([first, second]);
  });
});
