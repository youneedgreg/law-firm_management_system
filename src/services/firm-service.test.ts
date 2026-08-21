import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, TestClock } from "effect";
import {
  advocates,
  asAdvocate,
  asPartner,
  asReceptionist,
  asWanjiku,
  clients,
  lapsed,
  matters,
  sarah,
  TODAY,
} from "../../test/fixtures";
import {
  inMemoryAdvocates,
  inMemoryCases,
  inMemoryClients,
} from "../../test/in-memory-repositories";
import type { Principal } from "../domain/identity/principal";
import { FirmService } from "./firm-service";
import { CurrentUser } from "./policy";

/**
 * `FirmService`, and the list a firm actually needs from a staff page.
 *
 * Not the headcount — **whose practising certificate has lapsed**. An advocate
 * without one may not appear, `mayAppearInCourt` has refused to assign them a
 * matter since Phase 2, and until now nothing anywhere produced the list. The
 * firm found out at intake, one matter at a time.
 */

const firm = FirmService.Default.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      inMemoryAdvocates(advocates),
      inMemoryCases(matters),
      inMemoryClients(clients),
    ),
  ),
);

const rosterFor = (principal: Principal) =>
  Effect.flatMap(FirmService, (service) => service.roster()).pipe(
    Effect.provideService(CurrentUser, principal),
  );

const scenario = <A, E>(body: Effect.Effect<A, E, FirmService>) =>
  TestClock.setTime(TODAY).pipe(Effect.andThen(body), Effect.provide(firm));

describe("the staff register", () => {
  it.effect("lists everybody on the firm's books", () =>
    scenario(
      Effect.gen(function* () {
        const roster = yield* rosterFor(asPartner);

        expect(roster.staff).toHaveLength(advocates.length);
      }),
    ),
  );

  /**
   * **Inactive staff are included**, unlike every dropdown in the system.
   *
   * A dropdown offers choices, and somebody who has left is not a choice that
   * was nearly right. A register records who works here and who used to — and a
   * former employee vanishing from it is how a firm loses track of who carried
   * a matter three years ago.
   */
  it.effect("keeps somebody who has left, at the bottom", () =>
    scenario(
      Effect.gen(function* () {
        const roster = yield* rosterFor(asPartner);
        const names = roster.staff.map((member) => member.advocate.name);

        expect(names).toContain(lapsed.name);

        const inactive = roster.staff.filter(
          (member) => !member.advocate.active,
        );

        // Worthless as an ordering assertion if nobody has left.
        expect(inactive.length).toBeGreaterThan(0);

        const last = roster.staff.slice(-inactive.length);
        expect(last.every((member) => !member.advocate.active)).toBe(true);
      }),
    ),
  );

  /**
   * **The report this exists for.** `Firm.certificateLapsed` was written in
   * Phase 1 and had never been called by anything.
   */
  it.effect("names whoever cannot appear this year", () =>
    scenario(
      Effect.gen(function* () {
        const roster = yield* rosterFor(asPartner);

        // Peter's certificate is last year's, and he is still on the books.
        expect(
          roster.lapsed.map((member) => member.advocate.name),
        ).toStrictEqual([lapsed.name]);

        for (const member of roster.lapsed) {
          expect(member.certificateLapsed).toBe(true);
          expect(member.mayAppear).toBe(false);
          expect(member.advocate.active).toBe(true);
          expect(["Advocate", "Managing Partner"]).toContain(
            member.advocate.role,
          );
        }
      }),
    ),
  );

  /**
   * The other side of it: somebody whose certificate is current is not on the
   * list, so the report distinguishes rather than flagging every advocate.
   */
  it.effect("leaves a current certificate alone", () =>
    scenario(
      Effect.gen(function* () {
        const roster = yield* rosterFor(asPartner);
        const current = roster.staff.find(
          (member) => member.advocate.id === sarah.id,
        );

        expect(current?.mayAppear).toBe(true);
        expect(current?.certificateLapsed).toBe(false);
      }),
    ),
  );

  /**
   * A Receptionist may not appear in court and has no certificate to lapse.
   * Deriving `certificateLapsed` as `!mayAppear` would report every
   * non-advocate as a compliance problem, which is why it comes from the
   * domain's own list instead.
   */
  it.effect("does not call a non-advocate's certificate lapsed", () =>
    scenario(
      Effect.gen(function* () {
        const roster = yield* rosterFor(asPartner);

        for (const member of roster.staff) {
          if (
            member.advocate.role !== "Advocate" &&
            member.advocate.role !== "Managing Partner"
          ) {
            expect(member.mayAppear).toBe(false);
            expect(member.certificateLapsed).toBe(false);
          }
        }
      }),
    ),
  );

  it.effect("counts the open matters each person carries", () =>
    scenario(
      Effect.gen(function* () {
        const roster = yield* rosterFor(asPartner);
        const sarahsLoad = roster.staff.find(
          (member) => member.advocate.id === sarah.id,
        );

        expect(sarahsLoad?.openMatters).toBe(
          matters.filter(
            (matter) =>
              matter.advocateId === sarah.id && matter.status !== "Closed",
          ).length,
        );
      }),
    ),
  );

  it.effect("gives somebody carrying nothing a zero rather than nothing", () =>
    scenario(
      Effect.gen(function* () {
        const roster = yield* rosterFor(asPartner);

        for (const member of roster.staff) {
          expect(typeof member.openMatters).toBe("number");
          expect(member.openMatters).toBeGreaterThanOrEqual(0);
        }
      }),
    ),
  );

  /** Every staff role holds `staff:read` — the firm's own directory. */
  it.effect("is readable by a Receptionist", () =>
    scenario(
      Effect.gen(function* () {
        const roster = yield* rosterFor(asReceptionist);

        expect(roster.staff.length).toBeGreaterThan(0);
      }),
    ),
  );

  it.effect("is readable by an ordinary Advocate", () =>
    scenario(
      Effect.gen(function* () {
        const roster = yield* rosterFor(asAdvocate);

        expect(roster.staff.length).toBeGreaterThan(0);
      }),
    ),
  );

  /**
   * A client has no business with the firm's internal directory — who works
   * here, what they carry and whose certificate has lapsed.
   */
  it.effect("is refused to a portal user", () =>
    scenario(
      Effect.gen(function* () {
        const refused = yield* Effect.flip(rosterFor(asWanjiku));

        expect(refused._tag).toBe("NotPermitted");
      }),
    ),
  );
});
