import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Ref, TestClock } from "effect";
import {
  advocates,
  asAdvocate,
  asReceptionist,
  asWanjiku,
  asZenith,
  clientAsked,
  clientChased,
  clients,
  filedMatter,
  matters,
  messages,
  sarah,
  TODAY,
  unfiledMatter,
  wanjiku,
  zenith,
} from "../../test/fixtures";
import {
  inMemoryAdvocates,
  inMemoryAudit,
  inMemoryCases,
  inMemoryClients,
  inMemoryTransactor,
  messagesWithStore,
  restorable,
} from "../../test/in-memory-repositories";
import type * as Correspondence from "../domain/message/message";
import type { Principal } from "../domain/identity/principal";
import { AuditLog } from "./audit-service";
import { MessageService } from "./message-service";
import { CurrentUser } from "./policy";

/**
 * `MessageService`, over arrays.
 *
 * Three properties, and the first is the reason the module exists: the firm can
 * see who is waiting on a reply, including — especially — the client whose
 * message somebody read and did not answer.
 */

const firm = (seed: readonly Correspondence.Message[] = messages) => {
  const store = messagesWithStore(seed);
  const audit = inMemoryAudit();

  return {
    store,
    audit,
    layer: Layer.mergeAll(MessageService.Default, AuditLog.Default).pipe(
      Layer.provideMerge(AuditLog.Default),
      Layer.provideMerge(
        Layer.mergeAll(
          store.layer,
          inMemoryClients(clients),
          inMemoryCases(matters),
          inMemoryAdvocates(advocates),
          audit.layer,
          inMemoryTransactor(restorable(store.store)),
        ),
      ),
    ),
  };
};

const scenario = <A, E>(
  body: Effect.Effect<A, E, MessageService | AuditLog | CurrentUser>,
  options: {
    readonly as?: Principal;
    readonly seed?: readonly Correspondence.Message[];
  } = {},
) =>
  TestClock.setTime(TODAY).pipe(
    Effect.andThen(body),
    Effect.provideService(CurrentUser, options.as ?? asAdvocate),
    Effect.provide(firm(options.seed).layer),
  );

// ── Who is waiting ────────────────────────────────────────────────────────

describe("who is waiting on us", () => {
  /**
   * **The test this module exists for.**
   *
   * Wanjiku's first question was *read* on the 17th and never answered. Every
   * unread badge reports that thread as clear.
   */
  it("reports a client whose read message was never answered", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* MessageService;
        const waiting = yield* service.waiting();

        expect(waiting.map((entry) => entry.clientName)).toStrictEqual([
          wanjiku.name,
        ]);
        expect(waiting[0]?.seen).toBe(true);
      }),
    ));

  it("does not report a client the firm has answered", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* MessageService;
        const waiting = yield* service.waiting();

        expect(waiting.map((entry) => entry.clientId)).not.toContain(zenith.id);
      }),
    ));

  /**
   * Two questions in a row is one conversation waiting, and the clock runs from
   * the *first* — which is the honest number and the one a client would give.
   */
  it("counts a run of questions as one wait, from the earliest", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* MessageService;
        const waiting = yield* service.waiting();

        expect(waiting).toHaveLength(1);
        expect(waiting[0]?.since).toStrictEqual(clientAsked.sentAt);
        expect(waiting[0]?.body).toBe(clientAsked.body);
      }),
    ));

  it("puts the longest wait first", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* MessageService;
        const waiting = yield* service.waiting();
        const hours = waiting.map((entry) => entry.hours);

        expect(hours).toStrictEqual([...hours].sort((a, b) => b - a));
        expect(waiting[0]?.hours).toBeGreaterThan(0);
      }),
    ));

  it("reports nothing when every thread has been answered", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* MessageService;
        expect(yield* service.waiting()).toStrictEqual([]);
      }),
      { seed: messages.filter((message) => message.clientId === zenith.id) },
    ));

  /**
   * A portal user holds `message:read` and would otherwise be handed the
   * firm's whole queue — how long *other* clients have waited. An empty list
   * rather than a refusal: nothing is being concealed, because a client
   * genuinely has no queue of their own.
   */
  it("gives a portal user no queue at all", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* MessageService;
        expect(yield* service.waiting()).toStrictEqual([]);
      }),
      { as: asWanjiku },
    ));
});

// ── Reading a thread ──────────────────────────────────────────────────────

describe("reading a thread", () => {
  it("puts it in the order it was said, with the firm's names resolved", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* MessageService;
        const thread = yield* service.thread(wanjiku.id);

        expect(thread.clientName).toBe(wanjiku.name);
        expect(thread.entries.map((entry) => entry.message.body)).toStrictEqual(
          messages
            .filter((message) => message.clientId === wanjiku.id)
            .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime())
            .map((message) => message.body),
        );

        const opener = thread.entries[0];
        expect(Option.getOrThrow(opener!.authorName)).toBe(sarah.name);
      }),
    ));

  /** A client message names nobody, which is the tagged union working. */
  it("leaves a client's own message unattributed", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* MessageService;
        const thread = yield* service.thread(wanjiku.id);
        const asked = thread.entries.find(
          (entry) => entry.message.id === clientAsked.id,
        );

        expect(Option.isNone(asked!.authorName)).toBe(true);
      }),
    ));

  it("resolves the matter a message was filed against", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* MessageService;
        const thread = yield* service.thread(wanjiku.id);
        const asked = thread.entries.find(
          (entry) => entry.message.id === clientAsked.id,
        );
        const chased = thread.entries.find(
          (entry) => entry.message.id === clientChased.id,
        );

        expect(Option.getOrThrow(asked!.matterNumber)).toBe(filedMatter.number);
        // A general enquiry names no matter, and says so.
        expect(Option.isNone(chased!.matterNumber)).toBe(true);
      }),
    ));

  it("serves a portal user their own thread", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* MessageService;
        const thread = yield* service.thread(wanjiku.id);

        expect(thread.entries.length).toBeGreaterThan(0);
      }),
      { as: asWanjiku },
    ));

  /**
   * A client reading another client's correspondence is the failure the whole
   * portal is arranged to prevent, and it answers `NotFound` — a refusal would
   * confirm the thread exists.
   */
  it("does not serve a portal user somebody else's thread", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* MessageService;
        const refused = yield* Effect.flip(service.thread(zenith.id));

        expect(refused._tag).toBe("NotFound");
      }),
      { as: asWanjiku },
    ));
});

// ── Marking read ──────────────────────────────────────────────────────────

describe("marking read", () => {
  it("marks the client's messages read when staff open the thread", () =>
    Effect.gen(function* () {
      const built = firm();

      const thread = yield* TestClock.setTime(TODAY).pipe(
        Effect.andThen(
          Effect.flatMap(MessageService, (service) =>
            service.thread(wanjiku.id),
          ),
        ),
        Effect.provideService(CurrentUser, asAdvocate),
        Effect.provide(built.layer),
      );

      // The count reported is what was waiting when it was opened.
      expect(thread.unread).toBe(1);

      const after = yield* Ref.get(built.store.store);
      const chased = after.find((message) => message.id === clientChased.id);
      expect(Option.isSome(chased!.readAt)).toBe(true);
    }));

  /**
   * **The bug a single "mark this thread read" would produce.**
   *
   * A client opening their own thread must not mark their own messages as seen
   * by the firm — that would quietly empty the firm's queue every time
   * somebody refreshed the page, and the waiting report would report nothing
   * for exactly the clients who were waiting.
   */
  it("does not let a client mark their own messages seen by the firm", () =>
    Effect.gen(function* () {
      const built = firm();

      yield* TestClock.setTime(TODAY).pipe(
        Effect.andThen(
          Effect.flatMap(MessageService, (service) =>
            service.thread(wanjiku.id),
          ),
        ),
        Effect.provideService(CurrentUser, asWanjiku),
        Effect.provide(built.layer),
      );

      const after = yield* Ref.get(built.store.store);
      const chased = after.find((message) => message.id === clientChased.id);

      expect(Option.isNone(chased!.readAt)).toBe(true);
    }));

  /**
   * The first time stands. Overwriting would make a message look freshly seen
   * on every page load, and Postgres refuses a second, different read time
   * anyway — a fake that allowed it would let this pass and fail for real.
   */
  it("keeps the time a message was first seen", () =>
    Effect.gen(function* () {
      const built = firm();

      yield* TestClock.setTime(TODAY).pipe(
        Effect.andThen(
          Effect.flatMap(MessageService, (service) =>
            service.thread(wanjiku.id),
          ),
        ),
        Effect.provideService(CurrentUser, asAdvocate),
        Effect.provide(built.layer),
      );

      const after = yield* Ref.get(built.store.store);
      const asked = after.find((message) => message.id === clientAsked.id);

      expect(Option.getOrThrow(asked!.readAt)).toStrictEqual(
        Option.getOrThrow(clientAsked.readAt),
      );
    }));
});

// ── Sending ───────────────────────────────────────────────────────────────

describe("sending", () => {
  it("attributes a staff message to whoever is signed in", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* MessageService;
        const sent = yield* service.send({
          clientId: wanjiku.id,
          caseId: Option.some(filedMatter.id),
          body: "The hearing is listed for 3 September.",
        });

        expect(sent.author._tag).toBe("FromFirm");
        if (sent.author._tag === "FromFirm") {
          expect(sent.author.advocateId).toBe(asAdvocate.advocateId);
        }
        expect(sent.sentAt).toStrictEqual(TODAY);
        expect(Option.isNone(sent.readAt)).toBe(true);
      }),
    ));

  /**
   * A client's message names nobody — never the person who happens to hold the
   * login. The author comes from the principal's *kind*, not from a field.
   */
  it("attributes a portal message to the client and nobody in it", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* MessageService;
        const sent = yield* service.send({
          clientId: wanjiku.id,
          caseId: Option.none(),
          body: "Thank you.",
        });

        expect(sent.author._tag).toBe("FromClient");
      }),
      { as: asWanjiku },
    ));

  it("answers the waiting report once the firm replies", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* MessageService;

        expect(yield* service.waiting()).toHaveLength(1);

        yield* service.send({
          clientId: wanjiku.id,
          caseId: Option.none(),
          body: "Apologies for the delay — listed for 3 September.",
        });

        expect(yield* service.waiting()).toStrictEqual([]);
      }),
    ));

  /** A client's reply does not clear their own wait; only the firm's does. */
  it("does not let a client answer their own question", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* MessageService;

        yield* service
          .send({
            clientId: wanjiku.id,
            caseId: Option.none(),
            body: "Still waiting.",
          })
          .pipe(Effect.provideService(CurrentUser, asWanjiku));

        expect(yield* service.waiting()).toHaveLength(1);
      }),
    ));

  /**
   * Filing a message about one client's matter into another's thread would put
   * it in front of the wrong client — a disclosure rather than a typo. It is
   * its own refusal rather than a `NotFound`, because nothing is being
   * concealed from a member of staff who can see both.
   */
  it("refuses a matter that is not that client's", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* MessageService;
        const refused = yield* Effect.flip(
          service.send({
            clientId: wanjiku.id,
            caseId: Option.some(unfiledMatter.id),
            body: "About the other matter.",
          }),
        );

        expect(refused._tag).toBe("MatterIsNotTheirs");
      }),
    ));

  it("does not let a portal user write into another client's thread", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* MessageService;
        const refused = yield* Effect.flip(
          service.send({
            clientId: wanjiku.id,
            caseId: Option.none(),
            body: "Hello",
          }),
        );

        expect(refused._tag).toBe("NotFound");
      }),
      { as: asZenith },
    ));

  /** The front desk reads correspondence and does not write it. */
  it("does not let a Receptionist reply on the firm's behalf", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* MessageService;
        const refused = yield* Effect.flip(
          service.send({
            clientId: wanjiku.id,
            caseId: Option.none(),
            body: "He will call you back.",
          }),
        );

        expect(refused._tag).toBe("NotPermitted");
      }),
      { as: asReceptionist },
    ));

  /**
   * The body is in the audit snapshot deliberately: "what was said to this
   * client, and when" is the question asked after a complaint, and an entry
   * recording only that *a* message was sent cannot answer it.
   */
  it("records what was said, not merely that something was", () =>
    Effect.gen(function* () {
      const built = firm();

      yield* TestClock.setTime(TODAY).pipe(
        Effect.andThen(
          Effect.flatMap(MessageService, (service) =>
            service.send({
              clientId: wanjiku.id,
              caseId: Option.none(),
              body: "The hearing is listed for 3 September.",
            }),
          ),
        ),
        Effect.provideService(CurrentUser, asAdvocate),
        Effect.provide(built.layer),
      );

      const recorded = yield* built.audit.recorded;
      const entry = recorded.find((each) => each.action === "message.sent");

      expect(entry).toBeDefined();
      expect(JSON.stringify(entry?.after)).toContain("3 September");
    }));
});
