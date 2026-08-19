import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Ref, Schema, TestClock } from "effect";
import {
  advocates,
  clients,
  closedMatter,
  filedMatter,
  grace,
  lapsed,
  daniel,
  matters,
  sarah,
  TODAY,
  unfiledMatter,
  utc,
  wanjiku,
  zenith,
} from "../../test/fixtures";
import {
  inMemoryAdvocates,
  inMemoryCases,
  inMemoryClients,
} from "../../test/in-memory-repositories";
import type * as Matter from "../domain/case/case";
import { CaseId, CaseNumber, ClientId } from "../domain/shared/ids";
import { CaseService, type OpenMatter } from "./case-service";
import { CaseNumberTaken, CaseRepository } from "./repositories";

/**
 * `CaseService`, with no database anywhere.
 *
 * Every dependency is an interface the service declared, so the whole suite
 * runs on arrays: no container, no migrations, no cleanup between tests, and
 * nothing to skip when Docker is not running. That is the argument for
 * dependency injection made concrete — the Postgres implementations are tested
 * against real Postgres, and the *rules* are tested here at unit-test speed.
 *
 * The clock is set to a fixed day before anything runs. `mayAppearInCourt`
 * compares a certificate year against today, so a suite on the default
 * `TestClock` would be asking whether these advocates were in practice in 1970.
 */

const firm = (seed: readonly Matter.Case[] = matters) =>
  Layer.mergeAll(
    inMemoryCases(seed),
    inMemoryClients(clients),
    inMemoryAdvocates(advocates),
  );

const withFirm = (seed?: readonly Matter.Case[]) =>
  CaseService.Default.pipe(Layer.provideMerge(firm(seed)));

/** Sets the clock, then runs the body against a freshly seeded firm. */
const scenario = <A, E>(
  body: Effect.Effect<A, E, CaseService | CaseRepository>,
  seed?: readonly Matter.Case[],
) =>
  TestClock.setTime(TODAY).pipe(
    Effect.andThen(body),
    Effect.provide(withFirm(seed)),
  );

const intake: OpenMatter = {
  title: "Zenith Distributors Ltd v. Coastal Freight Ltd",
  type: "Commercial",
  clientId: zenith.id,
  advocateId: sarah.id,
  underCustomaryLaw: false,
  openedOn: utc("2026-08-19"),
};

const numbered = (reference: string) =>
  Schema.decodeSync(CaseNumber)(reference);

describe("reading the caseload", () => {
  it.effect("resolves the client and advocate names a list has to show", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* CaseService;
        const caseload = yield* service.caseload();

        expect(caseload).toHaveLength(3);

        const first = caseload.find(
          (summary) => summary.matter.id === filedMatter.id,
        );
        expect(first?.clientName).toBe("Wanjiku Mwangi");
        expect(first?.advocateName).toBe("Adv. Sarah Wanjiru");
      }),
    ),
  );

  it.effect("filters to one status", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* CaseService;
        const caseload = yield* service.caseload({ status: "Closed" });

        expect(caseload.map((summary) => summary.matter.id)).toEqual([
          closedMatter.id,
        ]);
      }),
    ),
  );

  it.effect("scopes to one advocate's own matters", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* CaseService;
        const mine = yield* service.caseload({ advocateId: grace.id });

        expect(mine.map((summary) => summary.matter.id)).toEqual([
          unfiledMatter.id,
        ]);
      }),
    ),
  );

  it.effect("applies both filters together", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* CaseService;
        const none = yield* service.caseload({
          advocateId: grace.id,
          status: "Closed",
        });

        expect(none).toEqual([]);
      }),
    ),
  );

  /**
   * The foreign keys make this impossible in Postgres. It is covered because
   * the alternative to a placeholder is a list of forty matters that fails to
   * render because one row is odd.
   */
  it.effect("names a missing advocate rather than failing the whole list", () =>
    Effect.gen(function* () {
      const service = yield* CaseService;
      const caseload = yield* service.caseload();

      expect(caseload[0]?.advocateName).toBe("Unassigned");
    }).pipe(
      Effect.provide(
        CaseService.Default.pipe(
          Layer.provideMerge(
            Layer.mergeAll(
              inMemoryCases([filedMatter]),
              inMemoryClients(clients),
              inMemoryAdvocates([]),
            ),
          ),
        ),
      ),
    ),
  );
});

describe("reading one matter file", () => {
  it.effect("assembles the matter, the records it names, and the clock", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* CaseService;
        const file = yield* service.file(filedMatter.id);

        expect(file.matter.number).toBe("OKL-2026-014");
        expect(file.client.name).toBe(wanjiku.name);
        expect(file.advocate.name).toBe(sarah.name);
        expect(file.limitation?.window.provision).toContain("Cap. 22");
        // Contract: six years from accrual on 2024-08-30, read on 2026-08-19.
        expect(file.limitation?.daysRemaining).toBeGreaterThan(0);
        expect(file.limitation?.urgency).toBe("comfortable");
      }),
    ),
  );

  it.effect("offers exactly the transitions the state machine allows", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* CaseService;
        const file = yield* service.file(closedMatter.id);

        expect(file.mayBeMovedTo).toEqual(["Appealed"]);
      }),
    ),
  );

  it.effect("has no limitation view where no clock can be computed", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* CaseService;
        const file = yield* service.file(unfiledMatter.id);

        expect(file.limitation).toBeUndefined();
      }),
    ),
  );

  it.effect("reports a matter that is not there", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* CaseService;
        const missing = Schema.decodeSync(CaseId)(
          "20000000-0000-4000-8000-0000000000ff",
        );

        const error = yield* Effect.flip(service.file(missing));
        expect(error._tag).toBe("NotFound");
      }),
    ),
  );
});

describe("opening a matter", () => {
  it.effect("issues the next reference for the year the file was opened", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* CaseService;
        const opened = yield* service.open(intake);

        // 014 and 032 are already issued for 2026, so the next is 033.
        expect(opened.number).toBe("OKL-2026-033");
        expect(opened.status).toBe("New");
      }),
    ),
  );

  it.effect("numbers by the intake year, not by today", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* CaseService;
        // Opened in December, entered in August of the following year.
        const opened = yield* service.open({
          ...intake,
          openedOn: utc("2025-12-30"),
        });

        expect(opened.number).toBe("OKL-2025-099");
      }),
    ),
  );

  it.effect("starts a year's numbering at 001", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* CaseService;
        const opened = yield* service.open({
          ...intake,
          openedOn: utc("2027-01-06"),
        });

        expect(opened.number).toBe("OKL-2027-001");
      }),
    ),
  );

  it.effect("stores what it returns", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* CaseService;
        const opened = yield* service.open(intake);
        const file = yield* service.file(opened.id);

        expect(file.matter).toEqual(opened);
      }),
    ),
  );

  it.effect("refuses a matter for a client the firm does not have", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* CaseService;
        const stranger = Schema.decodeSync(ClientId)(
          "00000000-0000-4000-8000-0000000000ff",
        );

        const error = yield* Effect.flip(
          service.open({ ...intake, clientId: stranger }),
        );

        expect(error._tag).toBe("NotFound");
        expect(error).toHaveProperty("entity", "Client");
      }),
    ),
  );

  it.effect("refuses to assign a matter to someone who has left", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* CaseService;
        const error = yield* Effect.flip(
          service.open({ ...intake, advocateId: daniel.id }),
        );

        expect(error._tag).toBe("AdvocateNotInPractice");
      }),
    ),
  );

  it.effect("refuses a claim beyond the magistrate's pecuniary limit", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* CaseService;
        const error = yield* Effect.flip(
          service.open({
            ...intake,
            claimValueCents: 9_000_000_00,
            court: {
              _tag: "MagistratesCourt",
              station: "Milimani",
              rank: "Resident Magistrate",
            },
          }),
        );

        expect(error._tag).toBe("OutsideCourtJurisdiction");
      }),
    ),
  );

  it.effect("refuses a magistrates' court filing with no value to check", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* CaseService;
        const error = yield* Effect.flip(
          service.open({
            ...intake,
            court: {
              _tag: "MagistratesCourt",
              station: "Milimani",
              rank: "Chief Magistrate",
            },
          }),
        );

        expect(error._tag).toBe("CannotFileWithoutValue");
      }),
    ),
  );

  it.effect("lets a superior court hear any value", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* CaseService;
        const opened = yield* service.open({
          ...intake,
          claimValueCents: 900_000_000_00,
          court: { _tag: "HighCourt", station: "Milimani" },
        });

        expect(opened.court?._tag).toBe("HighCourt");
      }),
    ),
  );

  it.effect("refuses a filing by someone with no current certificate", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* CaseService;
        const error = yield* Effect.flip(
          service.open({
            ...intake,
            advocateId: lapsed.id,
            filedOn: utc("2026-08-19"),
          }),
        );

        expect(error._tag).toBe("AdvocateMayNotFile");
      }),
    ),
  );

  /**
   * The certificate governs appearing in court, not carrying a file. A legal
   * assistant runs matters every day; what they may not do is file one.
   */
  it.effect("lets an unfiled matter be assigned to a legal assistant", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* CaseService;
        const opened = yield* service.open({
          ...intake,
          advocateId: grace.id,
        });

        expect(opened.advocateId).toBe(grace.id);
      }),
    ),
  );

  it.effect("refuses to file a matter through a legal assistant", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* CaseService;
        const error = yield* Effect.flip(
          service.open({
            ...intake,
            advocateId: grace.id,
            filedOn: utc("2026-08-19"),
          }),
        );

        expect(error._tag).toBe("AdvocateMayNotFile");
      }),
    ),
  );

  it.effect("refuses a cause number on a matter that was never filed", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* CaseService;
        const error = yield* Effect.flip(
          service.open({ ...intake, causeNumber: "HCCOMM E0091 of 2026" }),
        );

        expect(error._tag).toBe("CauseNumberWithoutFiling");
      }),
    ),
  );

  it.effect("refuses a filing date earlier than the intake date", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* CaseService;
        const error = yield* Effect.flip(
          service.open({
            ...intake,
            openedOn: utc("2026-08-19"),
            filedOn: utc("2026-07-01"),
          }),
        );

        expect(error._tag).toBe("FilingPrecedesIntake");
      }),
    ),
  );

  it.effect("refuses an accrual date with no basis to measure from it", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* CaseService;
        const error = yield* Effect.flip(
          service.open({ ...intake, accruedOn: utc("2024-08-30") }),
        );

        expect(error._tag).toBe("IncompleteLimitation");
      }),
    ),
  );

  it.effect("refuses once a year's references are exhausted", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* CaseService;
        const error = yield* Effect.flip(service.open(intake));

        expect(error._tag).toBe("MatterReferencesExhausted");
      }),
      [{ ...filedMatter, number: numbered("OKL-2026-999") }],
    ),
  );
});

/**
 * The reference is derived from what is stored, so two intakes at once compute
 * the same one. `cases.number` is `UNIQUE`, the loser is refused, and `open`
 * retries — which only means anything if the retry recomputes the number rather
 * than resubmitting the one that just lost.
 */
describe("two intakes racing for the same reference", () => {
  /** A store where the first save is beaten to the number by someone else. */
  const contended = Layer.effect(
    CaseRepository,
    Effect.gen(function* () {
      const store = yield* Ref.make<readonly Matter.Case[]>([]);
      const stolen = yield* Ref.make(false);

      return CaseRepository.of({
        all: () => Ref.get(store),
        forClient: () => Ref.get(store),
        openMatters: () => Ref.get(store),

        // `open` reads the caseload and writes; a read of one matter here
        // would mean the test is exercising a path it did not mean to.
        findById: () => Effect.dieMessage("not part of this scenario"),
        byId: () => Effect.dieMessage("not part of this scenario"),

        save: (matter) =>
          Effect.gen(function* () {
            if (!(yield* Ref.get(stolen))) {
              yield* Ref.set(stolen, true);
              // The other intake commits first, taking this reference.
              yield* Ref.update(store, (rows) => [
                ...rows,
                {
                  ...matter,
                  id: Schema.decodeSync(CaseId)(crypto.randomUUID()),
                  title: "The matter that got there first",
                },
              ]);
              return yield* Effect.fail(
                new CaseNumberTaken({ number: matter.number }),
              );
            }

            yield* Ref.update(store, (rows) => [...rows, matter]);
            return matter;
          }),
      });
    }),
  );

  it.effect("retries onto the next free reference", () =>
    TestClock.setTime(TODAY).pipe(
      Effect.andThen(
        Effect.gen(function* () {
          const service = yield* CaseService;
          const opened = yield* service.open(intake);

          expect(opened.number).toBe("OKL-2026-002");
          expect(opened.title).toBe(intake.title);
        }),
      ),
      Effect.provide(
        CaseService.Default.pipe(
          Layer.provideMerge(
            Layer.mergeAll(
              contended,
              inMemoryClients(clients),
              inMemoryAdvocates(advocates),
            ),
          ),
        ),
      ),
    ),
  );
});

describe("amending a matter", () => {
  it.effect("changes the fields given and leaves the rest alone", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* CaseService;
        const amended = yield* service.amend(filedMatter.id, {
          title: "Wanjiku Mwangi v. Nairobi Metro SACCO (amended)",
        });

        expect(amended.title).toContain("(amended)");
        expect(amended.causeNumber).toBe(filedMatter.causeNumber);
        expect(amended.claimValueCents).toBe(filedMatter.claimValueCents);
        expect(amended.status).toBe(filedMatter.status);
      }),
    ),
  );

  it.effect("re-checks the court against the new claim value", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* CaseService;
        // 4.2m was within a Chief Magistrate's 20m limit; 24m is not.
        const error = yield* Effect.flip(
          service.amend(filedMatter.id, { claimValueCents: 24_000_000_00 }),
        );

        expect(error._tag).toBe("OutsideCourtJurisdiction");
      }),
    ),
  );

  it.effect(
    "demands a current certificate when the matter is being filed",
    () =>
      scenario(
        Effect.gen(function* () {
          const service = yield* CaseService;
          const error = yield* Effect.flip(
            service.amend(unfiledMatter.id, { filedOn: utc("2026-08-19") }),
          );

          // Assigned to a legal assistant, who may run it but may not file it.
          expect(error._tag).toBe("AdvocateMayNotFile");
        }),
      ),
  );

  /**
   * The certificate on record is this year's, and the matter was filed in 2025.
   * Re-checking it on every edit would make historic files uneditable by anyone
   * whose certificate does not cover a year the system has no record of.
   */
  it.effect("does not re-file a matter that is already in court", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* CaseService;
        const amended = yield* service.amend(closedMatter.id, {
          title: "In re Estate of Njeri Kamau (deceased)",
        });

        expect(amended.title).toContain("(deceased)");
      }),
    ),
  );

  it.effect("refuses to amend a matter that is not there", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* CaseService;
        const missing = Schema.decodeSync(CaseId)(
          "20000000-0000-4000-8000-0000000000ff",
        );

        const error = yield* Effect.flip(
          service.amend(missing, { title: "Anything" }),
        );
        expect(error._tag).toBe("NotFound");
      }),
    ),
  );
});

describe("moving a matter through the lifecycle", () => {
  it.effect("performs a legal move and stores it", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* CaseService;
        const moved = yield* service.transition(filedMatter.id, "Under Review");

        expect(moved.status).toBe("Under Review");
        expect((yield* service.file(filedMatter.id)).matter.status).toBe(
          "Under Review",
        );
      }),
    ),
  );

  it.effect("refuses a move the state machine does not allow", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* CaseService;
        const error = yield* Effect.flip(
          service.transition(closedMatter.id, "Active"),
        );

        expect(error._tag).toBe("InvalidTransition");
        expect(error).toHaveProperty("from", "Closed");
      }),
    ),
  );

  /**
   * The current status is read from storage rather than taken from the caller,
   * so a second submit of the same form is refused instead of overwriting.
   */
  it.effect("refuses the same move submitted twice", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* CaseService;
        yield* service.transition(filedMatter.id, "Under Review");

        const error = yield* Effect.flip(
          service.transition(filedMatter.id, "Under Review"),
        );
        expect(error._tag).toBe("InvalidTransition");
      }),
    ),
  );

  it.effect("refuses to move a matter that is not there", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* CaseService;
        const missing = Schema.decodeSync(CaseId)(
          "20000000-0000-4000-8000-0000000000ff",
        );

        const error = yield* Effect.flip(service.transition(missing, "Active"));
        expect(error._tag).toBe("NotFound");
      }),
    ),
  );
});

describe("what an intake form may offer", () => {
  it.effect("lists clients and active advocates, by name", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* CaseService;
        const choices = yield* service.intakeChoices();

        expect(choices.clients.map((client) => client.name)).toEqual([
          "Wanjiku Mwangi",
          "Zenith Distributors Ltd",
        ]);
      }),
    ),
  );

  /** Someone who has left the firm is not a choice that was nearly right. */
  it.effect("leaves out staff who are no longer at the firm", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* CaseService;
        const choices = yield* service.intakeChoices();

        expect(choices.advocates.map((each) => each.name)).not.toContain(
          daniel.name,
        );
      }),
    ),
  );

  it.effect("marks who may file, against today's date", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* CaseService;
        const choices = yield* service.intakeChoices();
        const byId = new Map(
          choices.advocates.map((each) => [each.id, each.mayFile] as const),
        );

        expect(byId.get(sarah.id)).toBe(true);
        // A legal assistant may carry a matter and may not file one.
        expect(byId.get(grace.id)).toBe(false);
        // Last year's certificate does not cover this year's filing.
        expect(byId.get(lapsed.id)).toBe(false);
      }),
    ),
  );
});
