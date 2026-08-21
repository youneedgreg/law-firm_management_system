import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option, TestClock } from "effect";
import {
  advocates,
  asAdvocate,
  asPartner,
  asWanjiku,
  clients,
  contacts,
  currentPrecedent,
  filedMatter,
  grace,
  matters,
  precedents,
  recentCall,
  sarah,
  staleMeeting,
  stalePrecedent,
  TODAY,
  unfiledMatter,
  wanjiku,
  zenith,
} from "../../test/fixtures";
import {
  contactsWithStore,
  inMemoryAdvocates,
  inMemoryAudit,
  inMemoryCases,
  inMemoryClients,
  inMemoryPrecedents,
  inMemoryTransactor,
  restorable,
} from "../../test/in-memory-repositories";
import type * as Log from "../domain/firm/contact";
import type { Principal } from "../domain/identity/principal";
import { AuditLog } from "./audit-service";
import { LibraryService } from "./library-service";
import { CurrentUser } from "./policy";

/**
 * `LibraryService`, and the two questions these records exist to answer.
 *
 * A contact log that only says what *did* happen is a diary. A precedent bank
 * that only lists titles is a shelf. `neglected` and `bank().stale` are the
 * reports, and almost every test here is about one of them.
 */

const firm = (seed: readonly Log.Contact[] = contacts) => {
  const log = contactsWithStore(seed);
  const audit = inMemoryAudit();

  return {
    log,
    audit,
    layer: Layer.mergeAll(LibraryService.Default, AuditLog.Default).pipe(
      Layer.provideMerge(AuditLog.Default),
      Layer.provideMerge(
        Layer.mergeAll(
          log.layer,
          inMemoryPrecedents(precedents),
          inMemoryClients(clients),
          inMemoryCases(matters),
          inMemoryAdvocates(advocates),
          audit.layer,
          inMemoryTransactor(restorable(log.store)),
        ),
      ),
    ),
  };
};

const scenario = <A, E>(
  body: Effect.Effect<A, E, LibraryService | AuditLog | CurrentUser>,
  as: Principal = asPartner,
  seed?: readonly Log.Contact[],
) =>
  TestClock.setTime(TODAY).pipe(
    Effect.andThen(body),
    Effect.provideService(CurrentUser, as),
    Effect.provide(firm(seed).layer),
  );

// ── The contact log ───────────────────────────────────────────────────────

describe("the contact log", () => {
  it.effect("reads newest first, with the names resolved", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* LibraryService;
        const entries = yield* service.log();

        expect(entries[0]?.contact.id).toBe(recentCall.id);
        expect(entries[0]?.clientName).toBe(wanjiku.name);
        expect(entries[0]?.loggedByName).toBe(sarah.name);
        expect(Option.getOrThrow(entries[0]!.matterNumber)).toBe(
          filedMatter.number,
        );
      }),
    ),
  );

  /** A conversation about no particular matter says so rather than guessing. */
  it.effect("leaves a general conversation without a matter", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* LibraryService;
        const entries = yield* service.log();
        const meeting = entries.find(
          (entry) => entry.contact.clientId === zenith.id,
        );

        expect(Option.isNone(meeting!.matterNumber)).toBe(true);
      }),
    ),
  );

  it.effect("serves one client's history on their file", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* LibraryService;
        const history = yield* service.forClient(wanjiku.id);

        expect(history).toHaveLength(1);
        expect(history[0]?.contact.id).toBe(recentCall.id);
      }),
    ),
  );

  /**
   * The firm's log is internal: it names other clients, and it is the firm's
   * own notes rather than correspondence the client ever saw. A portal user
   * gets an empty list rather than a refusal, because they have no log of their
   * own to be denied.
   */
  it.effect("does not hand a portal user the firm's own notes", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* LibraryService;

        expect(yield* service.log()).toStrictEqual([]);
      }),
      asWanjiku,
    ),
  );

  it.effect("does not let a portal user read another client's file", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* LibraryService;
        const refused = yield* Effect.flip(service.forClient(zenith.id));

        expect(refused._tag).toBe("NotFound");
      }),
      asWanjiku,
    ),
  );
});

// ── Logging one ───────────────────────────────────────────────────────────

describe("logging a conversation", () => {
  it.effect("attributes it to whoever is signed in", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* LibraryService;
        const logged = yield* service.logContact({
          clientId: wanjiku.id,
          caseId: Option.some(filedMatter.id),
          channel: "Call",
          direction: "Incoming",
          summary: "She rang about the hearing bundle.",
          occurredOn: TODAY,
        });

        expect(logged.loggedBy).toBe(asAdvocate.advocateId);
      }),
      asAdvocate,
    ),
  );

  /**
   * A note about a conversation that has not happened yet is an appointment,
   * and this is not the appointments module. Accepted, it would sit at the top
   * of a log that reads newest-first and stay there.
   */
  it.effect("refuses a conversation dated in the future", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* LibraryService;
        const refused = yield* Effect.flip(
          service.logContact({
            clientId: wanjiku.id,
            caseId: Option.none(),
            channel: "Call",
            direction: "Outgoing",
            summary: "Will discuss the settlement.",
            occurredOn: new Date(TODAY.getTime() + 24 * 60 * 60 * 1000),
          }),
        );

        expect(refused._tag).toBe("LoggedInTheFuture");
      }),
    ),
  );

  /**
   * Filing a note about one client's matter on another's file puts it in front
   * of the wrong person — the same refusal a message gets, and now the *same
   * error*: it lives in the domain rather than being declared twice with one
   * tag.
   */
  it.effect("refuses a matter that is not that client's", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* LibraryService;
        const refused = yield* Effect.flip(
          service.logContact({
            clientId: wanjiku.id,
            caseId: Option.some(unfiledMatter.id),
            channel: "Email",
            direction: "Outgoing",
            summary: "About the other matter.",
            occurredOn: TODAY,
          }),
        );

        expect(refused._tag).toBe("MatterIsNotTheirs");
      }),
    ),
  );

  it.effect("records it in the audit trail", () =>
    Effect.gen(function* () {
      const built = firm();

      yield* TestClock.setTime(TODAY).pipe(
        Effect.andThen(
          Effect.flatMap(LibraryService, (service) =>
            service.logContact({
              clientId: wanjiku.id,
              caseId: Option.none(),
              channel: "WhatsApp",
              direction: "Outgoing",
              summary: "Sent the bundle index.",
              occurredOn: TODAY,
            }),
          ),
        ),
        Effect.provideService(CurrentUser, asPartner),
        Effect.provide(built.layer),
      );

      const recorded = yield* built.audit.recorded;
      expect(recorded.map((entry) => entry.action)).toContain("contact.logged");
    }),
  );
});

// ── Who have we neglected ─────────────────────────────────────────────────

describe("clients nobody has spoken to", () => {
  /**
   * **The report the log exists for**, and the case `lastContact` is an
   * `Option` for.
   *
   * Seeded with *only* Zenith's March meeting, so Wanjiku has an open matter
   * and no contact at all. She sorts above the client last spoken to five
   * months ago — "we have never spoken to them" and "we spoke in March" want
   * different reactions, and any numeric stand-in for "never" would have to be
   * picked to sort correctly rather than because it was true.
   */
  it.effect(
    "puts a client nobody has ever contacted above a long silence",
    () =>
      scenario(
        Effect.gen(function* () {
          const service = yield* LibraryService;
          const quiet = yield* service.neglected();

          expect(quiet.map((each) => each.clientId)).toStrictEqual([
            wanjiku.id,
            zenith.id,
          ]);

          expect(Option.isNone(quiet[0]!.lastContact)).toBe(true);
          expect(Option.isNone(quiet[0]!.days)).toBe(true);

          // And the one below does carry a figure.
          expect(Option.getOrThrow(quiet[1]!.days)).toBeGreaterThan(30);
        }),
        asPartner,
        [staleMeeting],
      ),
  );

  /** With nothing logged at all, everybody with open work is on the list. */
  it.effect("reports every client with open work when the log is empty", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* LibraryService;
        const quiet = yield* service.neglected();

        expect(quiet).toHaveLength(2);
        for (const row of quiet) {
          expect(Option.isNone(row.lastContact)).toBe(true);
        }
      }),
      asPartner,
      [],
    ),
  );

  it.effect("includes a client last spoken to months ago", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* LibraryService;
        const quiet = yield* service.neglected();

        const zenithRow = quiet.find((each) => each.clientId === zenith.id);

        expect(zenithRow).toBeDefined();
        expect(Option.getOrThrow(zenithRow!.days)).toBeGreaterThan(30);
      }),
    ),
  );

  /** Somebody spoken to last week is not neglected. */
  it.effect("leaves a recently contacted client out", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* LibraryService;
        const quiet = yield* service.neglected();

        expect(quiet.map((each) => each.clientId)).not.toContain(wanjiku.id);
      }),
    ),
  );

  /**
   * A client whose matters are all closed is not neglected — they are
   * finished. A list that said otherwise would be ignored within a month.
   */
  it.effect("does not chase a client with no open matter", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* LibraryService;
        const quiet = yield* service.neglected();

        for (const row of quiet) {
          expect(row.openMatters).toBeGreaterThan(0);
        }
      }),
    ),
  );

  it.effect("gives a portal user no view of other clients' silences", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* LibraryService;

        expect(yield* service.neglected()).toStrictEqual([]);
      }),
      asWanjiku,
    ),
  );
});

// ── The precedent bank ────────────────────────────────────────────────────

describe("the precedent bank", () => {
  it.effect("returns the whole bank, and separately what to check", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* LibraryService;
        const bank = yield* service.bank();

        expect(bank.precedents).toHaveLength(precedents.length);
        expect(bank.stale.map((each) => each.id)).toStrictEqual([
          stalePrecedent.id,
        ]);
      }),
    ),
  );

  /**
   * The other half: an entry reviewed this year is not on the list. A staleness
   * report that flagged everything would be indistinguishable from one that
   * flagged nothing.
   */
  it.effect("leaves a recently reviewed entry alone", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* LibraryService;
        const bank = yield* service.bank();

        expect(bank.stale.map((each) => each.id)).not.toContain(
          currentPrecedent.id,
        );
      }),
    ),
  );

  /** Every fee-earner uses the bank; it is gated on reading matters at all. */
  it.effect("is readable by an ordinary advocate", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* LibraryService;

        expect((yield* service.bank()).precedents.length).toBeGreaterThan(0);
      }),
      asAdvocate,
    ),
  );

  it.effect("names who added each entry", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* LibraryService;
        const bank = yield* service.bank();

        const known = new Set([sarah.id, grace.id]);
        for (const precedent of bank.precedents) {
          expect(known.has(precedent.addedBy)).toBe(true);
        }
      }),
    ),
  );
});
