import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option, TestClock } from "effect";
import {
  asAdvocate,
  asFinance,
  asPartner,
  asReceptionist,
  asZenith,
  clients,
  filedMatter,
  matters,
  TODAY,
  unfiledMatter,
  utc,
  wanjiku,
  zenith,
} from "../../test/fixtures";
import {
  inMemoryAudit,
  inMemoryCases,
  inMemoryClients,
  inMemoryTransactor,
} from "../../test/in-memory-repositories";
import type { Principal } from "../domain/identity/principal";
import { AuditLog } from "./audit-service";
import {
  ClientService,
  type AmendClient,
  type TakeOnClient,
} from "./client-service";
import { CurrentUser } from "./policy";

/**
 * `ClientService`, and mostly the conflict screen.
 *
 * `domain/client/conflicts.test.ts` already proves the matching rules against
 * hand-built `MatterRecord` values. What is untested until here is the *bridge*:
 * whether the firm's actual matters — a client on one side and an
 * `opposingParties` array on the other — assemble into the shape the screen
 * expects. That bridge did not exist before Phase 7, which is why the screen
 * was fully tested and had never been run.
 */

const firm = () => {
  const audit = inMemoryAudit();

  return {
    audit,
    layer: Layer.mergeAll(ClientService.Default, AuditLog.Default).pipe(
      Layer.provideMerge(AuditLog.Default),
      Layer.provideMerge(
        Layer.mergeAll(
          inMemoryClients(clients),
          inMemoryCases(matters),
          audit.layer,
          inMemoryTransactor(),
        ),
      ),
    ),
  };
};

const scenario = <A, E>(
  body: Effect.Effect<A, E, ClientService | AuditLog | CurrentUser>,
  who: Principal = asAdvocate,
) =>
  TestClock.setTime(TODAY).pipe(
    Effect.andThen(body),
    Effect.provideService(CurrentUser, who),
    Effect.provide(firm().layer),
  );

const intake: TakeOnClient = {
  _tag: "Individual",
  name: "Peter Kariuki",
  email: "peter.kariuki@example.co.ke",
  phone: "+254722445109" as never,
  onboardedOn: utc("2026-08-19"),
};

// ── Conflict screening ────────────────────────────────────────────────────

describe("screening a prospective retainer", () => {
  /**
   * One matter, two findings, and the ordering is the point.
   *
   * `unfiledMatter` is Zenith's, and its recorded opposing party is Coastal
   * Freight Ltd. So an enquiry *from* Coastal Freight *against* Zenith engages
   * that single matter from both directions at once:
   *
   * - the firm has acted **against** the prospective client, so information
   *   obtained then could be used to their disadvantage now; and
   * - the proposed opponent **is a current client**, so acting would put the
   *   firm directly against somebody it already represents.
   *
   * The second is the one that ends a retainer, and it sorts first — the screen
   * reports everything it matched and puts the most disqualifying finding where
   * an advocate reads it first. Nothing is filtered out on the model's own
   * authority.
   */
  it.effect("reports both sides of one matter, worst first", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* ClientService;

        const result = yield* service.screen({
          clientName: "Coastal Freight Ltd",
          opposingNames: ["Zenith Distributors Ltd"],
        });

        expect(result.findings.map((finding) => finding.kind)).toEqual([
          "opposing-party-is-current-client",
          "acted-against",
        ]);

        expect(
          result.findings.every(
            (finding) => finding.caseNumber === unfiledMatter.number,
          ),
        ).toBe(true);

        expect(result.findings[0]?.concern).toContain(
          "directly against its own client",
        );
      }),
    ),
  );

  /**
   * Name matching is deliberately blunt.
   *
   * "ZENITH DISTRIBUTORS LIMITED" and "Zenith Distributors Ltd" are the same
   * company, and a screen that missed that would produce a confident empty
   * result — which is much worse than a false positive, because a false
   * positive costs an advocate ten seconds.
   */
  it.effect("matches a company through punctuation, case and suffix", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* ClientService;

        const result = yield* service.screen({
          clientName: "Somebody Else",
          opposingNames: ["ZENITH DISTRIBUTORS LIMITED"],
        });

        expect(result.findings).toHaveLength(1);
      }),
    ),
  );

  /**
   * The other direction: the *enquirer* has been on the far side of one of the
   * firm's matters. Information obtained then could be used against them now.
   */
  it.effect("finds a prospective client the firm has acted against", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* ClientService;

        const result = yield* service.screen({
          clientName: "Nairobi Metro SACCO",
          opposingNames: [],
        });

        expect(result.findings).toHaveLength(1);
        expect(result.findings[0]?.kind).toBe("acted-against");
        expect(result.findings[0]?.caseNumber).toBe(filedMatter.number);
      }),
    ),
  );

  /**
   * An empty result is a statement about the records, not about the world.
   *
   * `mattersSearched` is what carries that qualification, and it survives all
   * the way from the domain through this service because nothing flattens the
   * result into a boolean. There is no `hasConflict()` and there never will be.
   */
  it.effect("says what it searched when it finds nothing", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* ClientService;

        const result = yield* service.screen({
          clientName: "Nobody In Particular",
          opposingNames: ["Also Nobody"],
        });

        expect(result.findings).toEqual([]);
        expect(result.mattersSearched).toBe(matters.length);
        expect(result.screenedAt.getTime()).toBe(TODAY.getTime());
      }),
    ),
  );

  /**
   * The screen is recorded, and it is the only read in the system that is.
   *
   * "Was a conflict check run before this file was opened, and what did it
   * show" is asked afterwards by somebody who was not there, and an unrecorded
   * screen is indistinguishable from one that never happened.
   */
  it.effect("records the screen, with the findings in the entry", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* ClientService;
        yield* service.screen({
          clientName: "Coastal Freight Ltd",
          opposingNames: ["Zenith Distributors Ltd"],
        });

        const audit = yield* AuditLog;
        const trail = yield* audit.trail();
        const entry = trail.find((each) => each.action === "client.screened");

        expect(entry).toBeDefined();
        expect(Option.isSome(entry?.after ?? Option.none())).toBe(true);
      }),
      asPartner,
    ),
  );

  it.effect("refuses a Receptionist, who does not take clients on", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* ClientService;
        const refused = yield* Effect.flip(
          service.screen({ clientName: "Anyone", opposingNames: [] }),
        );

        expect(refused._tag).toBe("NotPermitted");
      }),
      asReceptionist,
    ),
  );

  /**
   * A portal user holds `client:read`. A screen over the whole firm's matter
   * history is a different thing entirely, and `client:write` is what keeps
   * them out of it.
   */
  it.effect("keeps a client out of the firm's conflict history", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* ClientService;
        const refused = yield* Effect.flip(
          service.screen({ clientName: "Anyone", opposingNames: [] }),
        );

        expect(refused._tag).toBe("NotPermitted");
      }),
      asZenith,
    ),
  );
});

// ── Taking a client on ────────────────────────────────────────────────────

describe("taking a client on", () => {
  it.effect("numbers them from what the firm has already issued", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* ClientService;
        const client = yield* service.takeOn(intake);

        // CLT-1001 and CLT-2001 are seeded.
        expect(client.number).toBe("CLT-2002");
        expect(client._tag).toBe("Individual");
      }),
    ),
  );

  /**
   * A company with nobody able to instruct cannot be created, and the refusal
   * comes from the schema rather than from a check written here: `contacts` is
   * a `NonEmptyArray` on `Corporate`, so the decode refuses it.
   */
  it.effect(
    "refuses a corporate client with no one authorised to instruct",
    () =>
      scenario(
        Effect.gen(function* () {
          const service = yield* ClientService;

          const refused = yield* Effect.flip(
            service.takeOn({
              _tag: "Corporate",
              name: "Hollow Holdings Ltd",
              email: "info@hollow.co.ke",
              phone: "+254204453021" as never,
              onboardedOn: utc("2026-08-19"),
              contacts: [] as never,
            }),
          );

          expect(refused._tag).toBe("RepositoryFailure");
        }),
      ),
  );

  it.effect("records who took them on", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* ClientService;
        const client = yield* service.takeOn(intake);

        const audit = yield* AuditLog;
        const trail = yield* audit.trail();
        const entry = trail.find((each) => each.action === "client.opened");

        expect(Option.getOrNull(entry?.entityId ?? Option.none())).toBe(
          client.id,
        );
      }),
      asPartner,
    ),
  );

  it.effect(
    "refuses a Finance Officer, who bills clients and does not take them on",
    () =>
      scenario(
        Effect.gen(function* () {
          const service = yield* ClientService;
          const refused = yield* Effect.flip(service.takeOn(intake));

          expect(refused._tag).toBe("NotPermitted");
        }),
        asFinance,
      ),
  );
});

// ── Correcting ────────────────────────────────────────────────────────────

describe("correcting a client", () => {
  it.effect("applies only the fields supplied", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* ClientService;
        const amended = yield* service.amend(zenith.id, {
          email: "accounts@zenith.co.ke",
        });

        expect(amended.email).toBe("accounts@zenith.co.ke");
        expect(amended.name).toBe(zenith.name);
      }),
    ),
  );

  /**
   * The union made this unrepresentable; the amendment is where somebody would
   * otherwise reach for it, so the refusal lives here and names which half of
   * the union the record is on.
   */
  it.effect("refuses to give an individual a corporate contact", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* ClientService;

        const refused = yield* Effect.flip(
          service.amend(wanjiku.id, {
            contacts: [{ name: "Somebody", role: "Director" }],
          } as AmendClient),
        );

        expect(refused._tag).toBe("ContactsDoNotApply");
        if (refused._tag === "ContactsDoNotApply") {
          expect(refused.reason).toContain("in person");
        }
      }),
    ),
  );

  it.effect("records both sides of the change", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* ClientService;
        yield* service.amend(zenith.id, { email: "accounts@zenith.co.ke" });

        const audit = yield* AuditLog;
        const trail = yield* audit.trail();
        const entry = trail.find((each) => each.action === "client.amended");

        expect(Option.isSome(entry?.before ?? Option.none())).toBe(true);
        expect(Option.isSome(entry?.after ?? Option.none())).toBe(true);
      }),
      asPartner,
    ),
  );
});
