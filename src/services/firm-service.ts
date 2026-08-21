import { DateTime, Effect } from "effect";
import * as Firm from "../domain/firm/advocate";
import type { NotPermitted } from "../domain/identity/permissions";
import type { AdvocateId } from "../domain/shared/ids";
import { permitted, type CurrentUser } from "./policy";
import {
  AdvocateRepository,
  CaseRepository,
  type RepositoryFailure,
} from "./repositories";

/**
 * The firm's own people.
 *
 * ## `staff:read` gets its first operation here
 *
 * The permission has existed since Phase 6 and nothing has ever required it —
 * the same state `trust:write` was in until Phase 7 built the operations that
 * move client money, and the same state `conflicts.screen` was in until a
 * matter gained `opposingParties`. A grant with nothing behind it is a claim
 * the system does not honour, and this is where this one stops being one.
 *
 * ## The number this page exists for is not the headcount
 *
 * It is **whose practising certificate does not cover this year**. An advocate
 * without a current certificate may not appear, and `Firm.mayAppearInCourt`
 * has enforced that at intake since Phase 2 — refusing to assign a matter. What
 * has never existed until now is the *list*: the firm finding out before the
 * hearing rather than on the morning of it. `Firm.certificateLapsed` was
 * written in Phase 1 and, like the conflict screen, had never been called.
 *
 * ## Leave balances are gone
 *
 * The prototype's staff table showed "9 days", "18 days". Nothing records
 * leave, nothing accrues it and nothing deducts it, so the column was a number
 * with no source — and a leave balance that is wrong is worse than one that is
 * absent, because somebody books a holiday against it. It is not carried over,
 * and this note is why rather than an oversight.
 */

export interface StaffMember {
  readonly advocate: Firm.Advocate;
  /** Open matters they carry. The workload figure a partner manages by. */
  readonly openMatters: number;
  /**
   * Whether they may appear in court today.
   *
   * Only meaningful for the two roles that appear at all; a Finance Officer is
   * `false` here and that is not a problem with their certificate.
   */
  readonly mayAppear: boolean;
  /** A lapsed certificate, for somebody whose role requires one. */
  readonly certificateLapsed: boolean;
}

export interface Roster {
  readonly staff: readonly StaffMember[];
  /** Active staff whose certificate does not cover this year. */
  readonly lapsed: readonly StaffMember[];
  readonly asAt: Date;
}

export class FirmService extends Effect.Service<FirmService>()("FirmService", {
  effect: Effect.gen(function* () {
    const advocates = yield* AdvocateRepository;
    const cases = yield* CaseRepository;

    return {
      /**
       * Everyone on the staff list, with what they are carrying.
       *
       * **Inactive staff are included**, unlike every dropdown in the system,
       * which leaves them out. The difference is what the list is *for*: a
       * dropdown offers choices, and somebody who has left is not a choice that
       * was nearly right; a staff register is a record of who works here and
       * who used to, and a former employee vanishing from it is how a firm
       * loses track of who carried a matter three years ago.
       *
       * The workload counts **open matters only**, from one read of the
       * caseload rather than a count per person: forty round trips to render
       * six rows is the shape of query that looks fine on seed data.
       */
      roster: (): Effect.Effect<
        Roster,
        NotPermitted | RepositoryFailure,
        CurrentUser
      > =>
        Effect.gen(function* () {
          yield* permitted("staff:read");

          const [everyone, openMatters, asAt] = yield* Effect.all(
            [advocates.all(), cases.openMatters(), DateTime.nowAsDate],
            { concurrency: "unbounded" },
          );

          const load = new Map<AdvocateId, number>();
          for (const matter of openMatters) {
            load.set(matter.advocateId, (load.get(matter.advocateId) ?? 0) + 1);
          }

          const staff = everyone
            .map((advocate): StaffMember => {
              const mayAppear = Firm.mayAppearInCourt(advocate, asAt);
              return {
                advocate,
                openMatters: load.get(advocate.id) ?? 0,
                mayAppear,
                /**
                 * Derived from the domain's own list rather than restated as
                 * `!mayAppear`, which would be wrong: a Receptionist may not
                 * appear and has no certificate to lapse.
                 */
                certificateLapsed:
                  Firm.certificateLapsed([advocate], asAt).length > 0,
              };
            })
            /**
             * Active first, then by name. Somebody who has left belongs at the
             * bottom of a register rather than interleaved with the people
             * carrying today's work.
             */
            .sort(
              (a, b) =>
                Number(b.advocate.active) - Number(a.advocate.active) ||
                a.advocate.name.localeCompare(b.advocate.name),
            );

          return {
            staff,
            lapsed: staff.filter((member) => member.certificateLapsed),
            asAt,
          };
        }),
    };
  }),
}) {}
