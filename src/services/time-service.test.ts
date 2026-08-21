import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Schema, TestClock } from "effect";
import {
  advocates,
  asAdvocate,
  asFinance,
  asPartner,
  asReceptionist,
  asZenith,
  clients,
  closedMatter,
  draftingTime,
  matters,
  sarah,
  timeEntries,
  TODAY,
  unfiledMatter,
  utc,
  writtenOffTime,
} from "../../test/fixtures";
import {
  inMemoryAdvocates,
  inMemoryAudit,
  inMemoryCases,
  inMemoryClients,
  inMemoryTransactor,
  restorable,
  timeWithStore,
} from "../../test/in-memory-repositories";
import type { Principal } from "../domain/identity/principal";
import { InvoiceId, TimeEntryId } from "../domain/shared/ids";
import type * as Time from "../domain/time/entry";
import { AuditLog } from "./audit-service";
import { CurrentUser } from "./policy";
import { TimeService, type RecordTime } from "./time-service";
import { TimeRepository } from "./repositories";

/**
 * `TimeService`, with no database.
 *
 * The rules under test here are the ones that need a stored fact — the matter's
 * status, the entry's owner, whether it has been billed — and every one of them
 * runs against arrays at unit-test speed. The `carryOnto` race, which is the
 * only thing in this module that genuinely needs Postgres to be interesting, is
 * asserted against the fake here (for the *service's* reaction to it) and
 * against real Postgres in the integration suite (for the claim being atomic).
 */

const firm = (seed: readonly Time.TimeEntry[] = timeEntries) => {
  const time = timeWithStore(seed);
  const audit = inMemoryAudit();

  return {
    time,
    audit,
    layer: Layer.mergeAll(TimeService.Default, AuditLog.Default).pipe(
      Layer.provideMerge(AuditLog.Default),
      Layer.provideMerge(
        Layer.mergeAll(
          time.layer,
          inMemoryCases(matters),
          inMemoryClients(clients),
          inMemoryAdvocates(advocates),
          audit.layer,
          inMemoryTransactor(restorable(time.store)),
        ),
      ),
    ),
  };
};

const scenario = <A, E>(
  body: Effect.Effect<
    A,
    E,
    TimeService | TimeRepository | AuditLog | CurrentUser
  >,
  options: {
    readonly as?: Principal;
    readonly seed?: readonly Time.TimeEntry[];
  } = {},
) =>
  TestClock.setTime(TODAY).pipe(
    Effect.andThen(body),
    Effect.provideService(CurrentUser, options.as ?? asAdvocate),
    Effect.provide(firm(options.seed).layer),
  );

const work: RecordTime = {
  caseId: unfiledMatter.id,
  activity: "Research",
  minutes: 45,
  workedOn: utc("2026-08-19"),
  billable: true,
  hourlyRateCents: 20_000_00,
  narrative: "Researching the limitation position",
};

const invoiceId = Schema.decodeSync(InvoiceId)(
  "60000000-0000-4000-8000-0000000000aa",
);

// ── Recording ─────────────────────────────────────────────────────────────

describe("recording time", () => {
  it.effect("attributes the entry to whoever is asking", () =>
    scenario(
      Effect.gen(function* () {
        const time = yield* TimeService;
        const entry = yield* time.record(work);

        // `asAdvocate` is Sarah. There is no parameter that could have said
        // otherwise — see the note at the top of `time-service.ts`.
        expect(entry.advocateId).toBe(sarah.id);
        expect(Option.isNone(entry.invoicedOn)).toBe(true);
      }),
    ),
  );

  it.effect("records it against the matter, and audits who did it", () =>
    scenario(
      Effect.gen(function* () {
        const time = yield* TimeService;
        const entry = yield* time.record(work);

        const audit = yield* AuditLog;
        const trail = yield* audit.trail();

        const recorded = trail.find((each) => each.action === "time.recorded");
        expect(Option.getOrNull(recorded?.entityId ?? Option.none())).toBe(
          entry.id,
        );
      }),
      { as: asPartner },
    ),
  );

  /**
   * A closed matter does not accrue time.
   *
   * Nearly always the wrong matter picked from a list. Where it is not, the
   * matter should be reopened first — a decision with its own audit entry
   * rather than a side effect of somebody's timesheet.
   */
  it.effect("refuses time against a closed matter", () =>
    scenario(
      Effect.gen(function* () {
        const time = yield* TimeService;
        const refused = yield* Effect.flip(
          time.record({ ...work, caseId: closedMatter.id }),
        );

        expect(refused._tag).toBe("MatterIsClosed");
        if (refused._tag === "MatterIsClosed") {
          expect(refused.reason).toContain("Reopen the matter");
        }
      }),
    ),
  );

  it.effect("refuses a Receptionist, who does not record time", () =>
    scenario(
      Effect.gen(function* () {
        const time = yield* TimeService;
        const refused = yield* Effect.flip(time.record(work));

        expect(refused._tag).toBe("NotPermitted");
      }),
      { as: asReceptionist },
    ),
  );

  /**
   * A Finance Officer reads time and does not write it.
   *
   * The grant worth arguing with, and therefore the one with its own test: a
   * fee note is built from recorded time so finance must see it, but time
   * entered on a fee-earner's behalf is not that fee-earner's record of their
   * own work.
   */
  it.effect("lets finance read the timesheet and not write to it", () =>
    scenario(
      Effect.gen(function* () {
        const time = yield* TimeService;

        const sheet = yield* time.timesheet();
        expect(sheet.lines).toHaveLength(4);

        const refused = yield* Effect.flip(time.record(work));
        expect(refused._tag).toBe("NotPermitted");
      }),
      { as: asFinance },
    ),
  );
});

// ── Correcting ────────────────────────────────────────────────────────────

describe("correcting an entry", () => {
  it.effect("applies only the fields supplied", () =>
    scenario(
      Effect.gen(function* () {
        const time = yield* TimeService;
        const amended = yield* time.amend(draftingTime.id, { minutes: 180 });

        expect(amended.minutes).toBe(180);
        expect(amended.narrative).toBe(draftingTime.narrative);
        expect(amended.activity).toBe(draftingTime.activity);
      }),
    ),
  );

  /**
   * Billed work is fixed.
   *
   * The client has been told what they are paying for. Editing the underlying
   * entry afterwards makes the fee note and the timesheet disagree about the
   * same hours, which is exactly the discrepancy a taxing master looks for.
   */
  it.effect("refuses to edit work already carried onto a fee note", () =>
    scenario(
      Effect.gen(function* () {
        const time = yield* TimeService;
        const refused = yield* Effect.flip(
          time.amend(draftingTime.id, { minutes: 999 }),
        );

        expect(refused._tag).toBe("BilledWorkIsFixed");
        if (refused._tag === "BilledWorkIsFixed") {
          expect(refused.reason).toContain("credit the fee note");
        }
      }),
      {
        seed: [{ ...draftingTime, invoicedOn: Option.some(invoiceId) }],
      },
    ),
  );

  /**
   * Somebody else's entry is reported as absent, not as forbidden.
   *
   * The same reasoning as an out-of-scope matter: a refusal that says "that is
   * not yours" confirms it exists. A colleague's timesheet is not this caller's
   * to know about either way.
   */
  it.effect("hides another fee-earner's entry rather than refusing it", () =>
    scenario(
      Effect.gen(function* () {
        const time = yield* TimeService;
        const refused = yield* Effect.flip(
          // `juniorDraftingTime` is Grace's; `asAdvocate` is Sarah.
          time.amend(
            Schema.decodeSync(TimeEntryId)(
              "80000000-0000-4000-8000-000000000003",
            ),
            { minutes: 30 },
          ),
        );

        expect(refused._tag).toBe("NotFound");
      }),
    ),
  );

  it.effect("records the correction with both sides of the change", () =>
    scenario(
      Effect.gen(function* () {
        const time = yield* TimeService;
        yield* time.amend(draftingTime.id, { minutes: 180 });

        const audit = yield* AuditLog;
        const trail = yield* audit.trail();
        const entry = trail.find((each) => each.action === "time.amended");

        expect(entry).toBeDefined();
        expect(Option.isSome(entry?.before ?? Option.none())).toBe(true);
        expect(Option.isSome(entry?.after ?? Option.none())).toBe(true);
      }),
      { as: asPartner },
    ),
  );
});

// ── Reading ───────────────────────────────────────────────────────────────

describe("the timesheet", () => {
  it.effect("counts non-billable time toward utilisation", () =>
    scenario(
      Effect.gen(function* () {
        const time = yield* TimeService;
        const sheet = yield* time.timesheet();

        // 150 + 90 + 120 billable, 60 not.
        expect(sheet.totalMinutes).toBe(420);
        expect(sheet.billableMinutes).toBe(360);
        expect(sheet.utilisation).toBeCloseTo(360 / 420, 5);
      }),
    ),
  );

  it.effect("values billable work and writes off the rest", () =>
    scenario(
      Effect.gen(function* () {
        const time = yield* TimeService;
        const sheet = yield* time.timesheet();

        // 2.5h + 1.5h at 20,000 = 80,000; 2h at 8,000 = 16,000.
        expect(sheet.billableValue).toBe(96_000_00);
        expect(sheet.unbilledValue).toBe(96_000_00);

        const written = sheet.lines.find(
          (line) => line.entry.id === writtenOffTime.id,
        );
        expect(written?.value).toBe(0);
      }),
    ),
  );

  it.effect("resolves the matter reference and the fee-earner's name", () =>
    scenario(
      Effect.gen(function* () {
        const time = yield* TimeService;
        const sheet = yield* time.timesheet();

        const line = sheet.lines.find(
          (each) => each.entry.id === draftingTime.id,
        );
        expect(line?.matterNumber).toBe(unfiledMatter.number);
        expect(line?.advocateName).toBe(sarah.name);
      }),
    ),
  );

  it.effect("reports work in progress by matter, largest first", () =>
    scenario(
      Effect.gen(function* () {
        const time = yield* TimeService;
        const wip = yield* time.workInProgress();

        expect(wip).toHaveLength(1);
        expect(wip[0]?.matterNumber).toBe(unfiledMatter.number);
        expect(wip[0]?.value).toBe(96_000_00);
        // The written-off hour is not work in progress: it will never be
        // billed, so counting it would overstate what the firm is owed.
        expect(wip[0]?.minutes).toBe(360);
      }),
    ),
  );

  /**
   * A portal user cannot reach a timesheet at all.
   *
   * Deliberate, and a client *is* entitled to the narrative behind a fee note
   * they have been sent — but that is a different view, built from the invoice.
   * This one would hand them every entry on the matter, including the hours
   * written off and the ones not yet billed.
   */
  it.effect("keeps a client out of the firm's timesheet entirely", () =>
    scenario(
      Effect.gen(function* () {
        const time = yield* TimeService;
        const refused = yield* Effect.flip(time.timesheet());

        expect(refused._tag).toBe("NotPermitted");
      }),
      { as: asZenith },
    ),
  );

  it.effect("filters to one matter's unbilled work", () =>
    scenario(
      Effect.gen(function* () {
        const time = yield* TimeService;
        const unbilled = yield* time.unbilledFor(unfiledMatter.id);

        expect(unbilled).toHaveLength(3);
        expect(unbilled.every((entry) => entry.billable)).toBe(true);
      }),
      { as: asFinance },
    ),
  );
});

// ── The claim ─────────────────────────────────────────────────────────────

describe("claiming work for a fee note", () => {
  it.effect("takes only entries nobody else has claimed", () =>
    scenario(
      Effect.gen(function* () {
        const repository = yield* TimeRepository;

        const first = yield* repository.carryOnto(invoiceId, [
          draftingTime.id,
          Schema.decodeSync(TimeEntryId)(
            "80000000-0000-4000-8000-000000000002",
          ),
        ]);
        expect(first).toBe(2);

        /**
         * The same request again claims nothing, because both entries now carry
         * a fee note. That count is the whole mechanism: a second attempt does
         * not silently re-bill, it reports that it got none of what it asked
         * for, and `BillingService.raiseFromTime` fails the transaction on the
         * difference.
         */
        const second = yield* repository.carryOnto(invoiceId, [
          draftingTime.id,
          Schema.decodeSync(TimeEntryId)(
            "80000000-0000-4000-8000-000000000002",
          ),
        ]);
        expect(second).toBe(0);
      }),
    ),
  );

  it.effect("never claims non-billable work", () =>
    scenario(
      Effect.gen(function* () {
        const repository = yield* TimeRepository;
        const claimed = yield* repository.carryOnto(invoiceId, [
          writtenOffTime.id,
        ]);

        expect(claimed).toBe(0);
      }),
    ),
  );

  it.effect("leaves the store untouched when asked for nothing", () =>
    scenario(
      Effect.gen(function* () {
        const repository = yield* TimeRepository;
        expect(yield* repository.carryOnto(invoiceId, [])).toBe(0);
      }),
    ),
  );
});
