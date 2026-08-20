import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Ref, TestClock } from "effect";
import {
  advocates,
  asFinance,
  asPartner,
  asWanjiku,
  clients,
  filedMatter,
  matters,
  sarah,
  TODAY,
  utc,
  zenith,
} from "../../test/fixtures";
import {
  casesWithStore,
  inMemoryAdvocates,
  inMemoryAudit,
  inMemoryClients,
  inMemoryTransactor,
  restorable,
} from "../../test/in-memory-repositories";
import * as Audit from "../domain/audit/entry";
import { AuditLog } from "./audit-service";
import { CaseService, type OpenMatter } from "./case-service";
import { CurrentUser } from "./policy";
import { AuditRepository, RepositoryFailure } from "./repositories";

/**
 * The audit trail: what gets recorded, by whom, and what happens when the
 * recording fails.
 *
 * The third of those is the one worth having. A trail that is written after the
 * fact, outside the transaction, produces exactly the gap it exists to close: a
 * matter that was opened with no record of who opened it, on the one occasion
 * something went wrong. So the last test here breaks the audit write on purpose
 * and asserts that the matter does not survive it.
 */

const intake: OpenMatter = {
  title: "Zenith Distributors Ltd v. Coastal Freight Ltd",
  type: "Commercial",
  clientId: zenith.id,
  advocateId: sarah.id,
  underCustomaryLaw: false,
  openedOn: utc("2026-08-19"),
};

/** The firm, plus a way to read back what was recorded. */
const withAudit = (audit: ReturnType<typeof inMemoryAudit>) => {
  const cases = casesWithStore(matters);

  return {
    store: cases.store,
    layer: Layer.mergeAll(CaseService.Default, AuditLog.Default).pipe(
      Layer.provideMerge(AuditLog.Default),
      Layer.provideMerge(
        Layer.mergeAll(
          cases.layer,
          inMemoryClients(clients),
          inMemoryAdvocates(advocates),
          audit.layer,
          inMemoryTransactor(restorable(cases.store)),
        ),
      ),
    ),
  };
};

describe("recording what was done", () => {
  it.effect("records who opened a matter, and what was written", () => {
    const audit = inMemoryAudit();
    const firm = withAudit(audit);

    return TestClock.setTime(TODAY).pipe(
      Effect.andThen(
        Effect.gen(function* () {
          const service = yield* CaseService;
          const opened = yield* service.open(intake);

          const trail = yield* audit.recorded;
          expect(trail).toHaveLength(1);

          const entry = trail[0];
          expect(entry?.action).toBe("case.opened");
          expect(entry?.entity).toBe("case");
          expect(Option.getOrNull(entry?.entityId ?? Option.none())).toBe(
            opened.id,
          );

          // The actor is copied, not joined: the entry has to go on saying
          // this after the person leaves or changes their name.
          expect(entry?.actor.name).toBe(asPartner.name);
          expect(entry?.actor.role).toBe("Managing Partner");
          expect(Option.getOrNull(entry?.actor.userId ?? Option.none())).toBe(
            asPartner.userId,
          );

          // An intake has no "before" — there was no record.
          expect(Option.isNone(entry?.before ?? Option.none())).toBe(true);
          expect(
            Option.getOrNull(entry?.after ?? Option.none())?.["number"],
          ).toBe(opened.number);
        }),
      ),
      Effect.provideService(CurrentUser, asPartner),
      Effect.provide(firm.layer),
    );
  });

  it.effect("records a status move as a before and an after", () => {
    const audit = inMemoryAudit();
    const firm = withAudit(audit);

    return TestClock.setTime(TODAY).pipe(
      Effect.andThen(
        Effect.gen(function* () {
          const service = yield* CaseService;
          yield* service.transition(filedMatter.id, "Judgment Pending");

          const trail = yield* audit.recorded;
          const entry = trail[0];

          expect(entry?.action).toBe("case.transitioned");

          /**
           * The whole matter is snapshotted on both sides, and `changes`
           * reports the one field that moved. That is the assertion worth
           * making: a snapshot of `{ status }` alone would satisfy a weaker
           * version of this test and lose the ability to answer "what else was
           * true about this matter at the time".
           */
          const moved = entry === undefined ? [] : Audit.changes(entry);
          expect(moved).toEqual([
            {
              field: "status",
              from: "Hearing Scheduled",
              to: "Judgment Pending",
            },
          ]);
        }),
      ),
      Effect.provideService(CurrentUser, asPartner),
      Effect.provide(firm.layer),
    );
  });

  /**
   * **The mutation test for the transaction.**
   *
   * The audit repository is replaced with one that refuses every write. If the
   * matter is still there afterwards, the audit entry and the write it
   * describes are not atomic — which is the failure this design exists to
   * prevent, and which no amount of reading the code proves absent.
   *
   * Deleting `transactor.transaction` from `CaseService.open` fails exactly
   * this test.
   */
  it.effect("does not open a matter it cannot record", () => {
    const cases = casesWithStore(matters);

    const refusing = Layer.succeed(
      AuditRepository,
      AuditRepository.of({
        record: () =>
          Effect.fail(
            new RepositoryFailure({
              operation: "record",
              detail: "audit_log is unavailable",
            }),
          ),
        recent: () => Effect.succeed([]),
        forEntity: () => Effect.succeed([]),
      }),
    );

    return TestClock.setTime(TODAY).pipe(
      Effect.andThen(
        Effect.gen(function* () {
          const service = yield* CaseService;
          const before = yield* Ref.get(cases.store);

          const failure = yield* Effect.flip(service.open(intake));
          expect(failure._tag).toBe("RepositoryFailure");

          const after = yield* Ref.get(cases.store);
          expect(after).toHaveLength(before.length);
          expect(after.some((matter) => matter.title === intake.title)).toBe(
            false,
          );
        }),
      ),
      Effect.provideService(CurrentUser, asPartner),
      Effect.provide(
        Layer.mergeAll(CaseService.Default, AuditLog.Default).pipe(
          Layer.provideMerge(AuditLog.Default),
          Layer.provideMerge(
            Layer.mergeAll(
              cases.layer,
              inMemoryClients(clients),
              inMemoryAdvocates(advocates),
              refusing,
              inMemoryTransactor(restorable(cases.store)),
            ),
          ),
        ),
      ),
    );
  });
});

describe("reading the trail", () => {
  const readableBy = (audit: ReturnType<typeof inMemoryAudit>) =>
    AuditLog.Default.pipe(Layer.provideMerge(audit.layer));

  it.effect("is refused to a role without audit:read", () => {
    const audit = inMemoryAudit();

    return Effect.gen(function* () {
      const log = yield* AuditLog;
      const refused = yield* Effect.flip(log.trail());

      expect(refused._tag).toBe("NotPermitted");
    }).pipe(
      Effect.provideService(CurrentUser, asFinance),
      Effect.provide(readableBy(audit)),
    );
  });

  /**
   * A portal user is refused it too, and for the same reason as a Finance
   * Officer rather than a different one: the trail names other people, so it is
   * not "their own audit trail scoped down" — it is not theirs at all.
   */
  it.effect("is refused to a portal user", () => {
    const audit = inMemoryAudit();

    return Effect.gen(function* () {
      const log = yield* AuditLog;
      const refused = yield* Effect.flip(log.trail());

      expect(refused._tag).toBe("NotPermitted");
    }).pipe(
      Effect.provideService(CurrentUser, asWanjiku),
      Effect.provide(readableBy(audit)),
    );
  });

  it.effect("is allowed to a Managing Partner", () => {
    const audit = inMemoryAudit();

    return Effect.gen(function* () {
      const log = yield* AuditLog;
      expect(yield* log.trail()).toEqual([]);
    }).pipe(
      Effect.provideService(CurrentUser, asPartner),
      Effect.provide(readableBy(audit)),
    );
  });
});
