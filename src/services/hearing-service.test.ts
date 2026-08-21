import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option, TestClock } from "effect";
import {
  advocates,
  asAdvocate,
  asPartner,
  asReceptionist,
  asZenith,
  clients,
  closedMatter,
  courtDates,
  filedMatter,
  grace,
  matters,
  missedHearing,
  recordedHearing,
  sarah,
  TODAY,
  unfiledMatter,
  upcomingHearing,
} from "../../test/fixtures";
import {
  hearingsWithStore,
  inMemoryAdvocates,
  inMemoryAudit,
  inMemoryCases,
  inMemoryClients,
  inMemoryTransactor,
  restorable,
} from "../../test/in-memory-repositories";
import * as Court from "../domain/court/court";
import * as Hearing from "../domain/court/hearing";
import type { Principal } from "../domain/identity/principal";
import { AuditLog } from "./audit-service";
import { HearingService, type ListHearing } from "./hearing-service";
import { CurrentUser } from "./policy";

/**
 * `HearingService`, with no database.
 *
 * The two properties under test are the two ways a court date is actually lost.
 *
 * A hearing whose date has passed with nothing recorded must surface by itself
 * — `awaitingOutcome` is the report, and it is asserted against a fixed clock
 * because on a real one the fixtures would drift from "upcoming" to "missed"
 * one at a time over a fortnight.
 *
 * An adjournment must leave the matter *listed*. The domain already refuses an
 * `Adjourned` with no destination; what this suite adds is that the destination
 * becomes a diary entry in the same transaction, so there is no window in which
 * the adjournment is recorded and the next date is not.
 */

const firm = (seed: readonly Hearing.Hearing[] = courtDates) => {
  const hearings = hearingsWithStore(seed);
  const audit = inMemoryAudit();

  return {
    hearings,
    audit,
    layer: Layer.mergeAll(HearingService.Default, AuditLog.Default).pipe(
      Layer.provideMerge(AuditLog.Default),
      Layer.provideMerge(
        Layer.mergeAll(
          hearings.layer,
          inMemoryCases(matters),
          inMemoryClients(clients),
          inMemoryAdvocates(advocates),
          audit.layer,
          inMemoryTransactor(restorable(hearings.store)),
        ),
      ),
    ),
  };
};

const scenario = <A, E>(
  body: Effect.Effect<A, E, HearingService | AuditLog | CurrentUser>,
  options: {
    readonly as?: Principal;
    readonly seed?: readonly Hearing.Hearing[];
  } = {},
) =>
  TestClock.setTime(TODAY).pipe(
    Effect.andThen(body),
    Effect.provideService(CurrentUser, options.as ?? asAdvocate),
    Effect.provide(firm(options.seed).layer),
  );

const listing: ListHearing = {
  caseId: filedMatter.id,
  kind: "Mention",
  court: filedMatter.court as Court.Court,
  scheduledFor: new Date("2026-10-01T06:00:00Z"),
  advocateId: sarah.id,
};

// ── The diary ─────────────────────────────────────────────────────────────

describe("the court diary", () => {
  /**
   * The report the whole module exists for.
   *
   * A hearing whose date has passed with no outcome is either an
   * administrative gap or a missed attendance, and a firm needs to know which
   * before the other side raises it. It is the first field on `Diary` rather
   * than something to go looking for.
   */
  it.effect("surfaces a past date with nothing recorded", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* HearingService;
        const diary = yield* service.diary();

        expect(diary.awaitingOutcome.map((each) => each.hearing.id)).toEqual([
          missedHearing.id,
        ]);
      }),
    ),
  );

  /**
   * One clock reading, three lists.
   *
   * The point of assembling them together: `upcoming` and `awaitingOutcome`
   * are the same set cut at a moment, and computing them from two reads would
   * let a hearing appear in both or in neither depending on how long the
   * second took.
   */
  it.effect("puts every hearing in exactly one list", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* HearingService;
        const diary = yield* service.diary();

        const seen = [
          ...diary.awaitingOutcome,
          ...diary.upcoming,
          ...diary.past,
        ].map((each) => each.hearing.id);

        expect(new Set(seen).size).toBe(courtDates.length);
        expect(diary.asAt.getTime()).toBe(TODAY.getTime());
      }),
    ),
  );

  it.effect("resolves the matter, the client and the court", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* HearingService;
        const diary = yield* service.diary();

        const entry = diary.upcoming.find(
          (each) => each.hearing.id === upcomingHearing.id,
        );

        expect(entry?.matterNumber).toBe(filedMatter.number);
        expect(entry?.clientName).toBe("Wanjiku Mwangi");
        expect(entry?.advocateName).toBe(sarah.name);
        // The rank is part of the name: it is what decides what the court may
        // hear, so "Milimani" alone would be ambiguous between a 5m ceiling
        // and a 20m one.
        expect(entry?.courtName).toBe("Chief Magistrate's Court at Milimani");
      }),
    ),
  );

  /**
   * A Receptionist reads the diary and cannot write it.
   *
   * They answer the telephone to a client asking when their matter is next in
   * court; listing a matter follows from what the court directed, not from
   * what somebody was told on the phone.
   */
  it.effect("lets a Receptionist read the diary and not list a matter", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* HearingService;

        const diary = yield* service.diary();
        expect(diary.upcoming.length).toBeGreaterThan(0);

        const refused = yield* Effect.flip(service.list(listing));
        expect(refused._tag).toBe("NotPermitted");
      }),
      { as: asReceptionist },
    ),
  );

  it.effect("keeps a client out of the firm's diary entirely", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* HearingService;
        const refused = yield* Effect.flip(service.diary());

        expect(refused._tag).toBe("NotPermitted");
      }),
      { as: asZenith },
    ),
  );
});

// ── Listing ───────────────────────────────────────────────────────────────

describe("listing a matter", () => {
  it.effect("puts it on the diary", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* HearingService;
        const listed = yield* service.list(listing);

        expect(listed.outcome).toBeUndefined();

        const diary = yield* service.diary();
        expect(diary.upcoming.map((each) => each.hearing.id)).toContain(
          listed.id,
        );
      }),
    ),
  );

  /**
   * A date behind today is refused rather than accepted.
   *
   * It is almost always a mistyped year, and a hearing listed in the past
   * appears immediately in `awaitingOutcome` — indistinguishable from a
   * genuinely missed attendance, which is the one report that must not have
   * noise in it.
   */
  it.effect("refuses a hearing listed in the past", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* HearingService;
        const refused = yield* Effect.flip(
          service.list({
            ...listing,
            scheduledFor: new Date("2025-10-01T06:00:00Z"),
          }),
        );

        expect(refused._tag).toBe("ListedInThePast");
        if (refused._tag === "ListedInThePast") {
          expect(refused.reason).toContain("check the year");
        }
      }),
    ),
  );

  it.effect("refuses a closed matter", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* HearingService;
        const refused = yield* Effect.flip(
          service.list({ ...listing, caseId: closedMatter.id }),
        );

        expect(refused._tag).toBe("MatterNotOpen");
        if (refused._tag === "MatterNotOpen") {
          expect(refused.reason).toContain("reopened");
        }
      }),
    ),
  );

  /**
   * The same pecuniary check intake runs, applied to the listing.
   *
   * A magistrates' court that could not have heard the claim at filing cannot
   * hear it now either, and two different answers to that question would be
   * worse than one — so `canFileIn` is reused rather than reimplemented.
   */
  it.effect("refuses a court that cannot hear the claim", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* HearingService;

        const refused = yield* Effect.flip(
          service.list({
            ...listing,
            caseId: unfiledMatter.id,
            advocateId: grace.id,
            court: Court.MagistratesCourt.make({
              station: "Milimani",
              rank: "Resident Magistrate",
            }),
          }),
        );

        expect(refused._tag).toBe("OutsideCourtJurisdiction");
      }),
    ),
  );
});

// ── Recording ─────────────────────────────────────────────────────────────

describe("recording how a hearing went", () => {
  it.effect("records a hearing that was heard", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* HearingService;

        const { hearing, next } = yield* service.record(missedHearing.id, {
          outcome: Hearing.Outcome.members[0].make({
            note: "Directions given",
          }),
        });

        expect(hearing.outcome?._tag).toBe("Heard");
        expect(next).toBeUndefined();
      }),
    ),
  );

  /**
   * **The adjournment lists the follow-on, in the same transaction.**
   *
   * This is the property the module exists for. The domain already refuses an
   * `Adjourned` with no destination; what this asserts is that the destination
   * *becomes a diary entry* — so there is no window in which the adjournment is
   * recorded and the next date is not, and no chance for the second act to be
   * forgotten at four o'clock on a Friday.
   *
   * The follow-on inherits the court, the room and the advocate, because an
   * adjournment is the same matter in the same court on a different day.
   */
  it.effect("lists the follow-on when a hearing is adjourned", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* HearingService;
        const adjournedTo = new Date("2026-11-03T06:00:00Z");

        const { hearing, next } = yield* service.record(missedHearing.id, {
          outcome: Hearing.Outcome.members[1].make({
            adjournedTo,
            reason: "Respondent's counsel not ready",
          }),
        });

        expect(hearing.outcome?._tag).toBe("Adjourned");
        expect(next).toBeDefined();
        expect(next?.scheduledFor.getTime()).toBe(adjournedTo.getTime());
        expect(next?.caseId).toBe(missedHearing.caseId);
        expect(next?.court).toStrictEqual(missedHearing.court);
        expect(next?.advocateId).toBe(missedHearing.advocateId);
        expect(next?.outcome).toBeUndefined();

        // And it is on the diary the very next read — which is the whole point.
        const diary = yield* service.diary();
        expect(diary.upcoming.map((each) => each.hearing.id)).toContain(
          next?.id,
        );
        expect(diary.awaitingOutcome).toEqual([]);
      }),
    ),
  );

  /**
   * An adjournment to a date at or before the hearing is refused.
   *
   * Always a typo, usually a year entered wrong, and it would place the matter
   * in the past where no diary view surfaces it again.
   */
  it.effect("refuses an adjournment into the past", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* HearingService;

        const refused = yield* Effect.flip(
          service.record(missedHearing.id, {
            outcome: Hearing.Outcome.members[1].make({
              adjournedTo: new Date("2026-08-01T06:00:00Z"),
              reason: "Mistyped year",
            }),
          }),
        );

        expect(refused._tag).toBe("AdjournedIntoThePast");
      }),
    ),
  );

  /**
   * What happened in court is a matter of record and is not overwritten.
   *
   * Not a validation quibble: the account of a day in court is evidence, and a
   * design that lets it be silently replaced is a design where the replacement
   * leaves no trace of what it replaced.
   */
  it.effect("refuses to overwrite an outcome already recorded", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* HearingService;

        const refused = yield* Effect.flip(
          service.record(recordedHearing.id, {
            outcome: Hearing.Outcome.members[3].make({}),
          }),
        );

        expect(refused._tag).toBe("OutcomeAlreadyRecorded");
        if (refused._tag === "OutcomeAlreadyRecorded") {
          expect(refused.recorded).toBe("Heard");
        }
      }),
    ),
  );

  it.effect("records both the outcome and the follow-on listing", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* HearingService;

        yield* service.record(missedHearing.id, {
          outcome: Hearing.Outcome.members[1].make({
            adjournedTo: new Date("2026-11-03T06:00:00Z"),
            reason: "Respondent's counsel not ready",
          }),
        });

        const audit = yield* AuditLog;
        const trail = yield* audit.trail();
        const actions = trail.map((each) => each.action);

        // Two entries for one act, because two things happened: the day in
        // court, and the new date.
        expect(actions).toContain("hearing.recorded");
        expect(actions).toContain("hearing.scheduled");

        const recorded = trail.find(
          (each) => each.action === "hearing.recorded",
        );
        expect(Option.isSome(recorded?.before ?? Option.none())).toBe(true);
      }),
      { as: asPartner },
    ),
  );
});
