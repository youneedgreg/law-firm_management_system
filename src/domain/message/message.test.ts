import { describe, expect, it } from "vitest";
import { Option, Schema } from "effect";
import { AdvocateId, CaseId, ClientId, MessageId } from "../shared/ids";
import {
  awaitingReply,
  inOrder,
  isFromClient,
  isRead,
  markRead,
  type Message,
  unreadFromClient,
  waitingHours,
} from "./message";

/**
 * Messages, and the one question a chat log cannot answer.
 *
 * "Which clients are waiting on us?" is not "which messages are unread" — a
 * message somebody opened and did not answer is *worse* than one nobody
 * opened, because it looks handled. Almost every test here is about that
 * distinction.
 */

const messageId = (n: number) =>
  Schema.decodeSync(MessageId)(`d0000000-0000-4000-8000-00000000000${n}`);

const client = Schema.decodeSync(ClientId)(
  "30000000-0000-4000-8000-000000000001",
);
const advocate = Schema.decodeSync(AdvocateId)(
  "10000000-0000-4000-8000-000000000001",
);
const matter = Schema.decodeSync(CaseId)(
  "20000000-0000-4000-8000-000000000001",
);

const at = (iso: string) => new Date(iso);

const fromClient = (n: number, sentAt: string, read = false): Message => ({
  id: messageId(n),
  clientId: client,
  caseId: Option.none(),
  author: { _tag: "FromClient" },
  body: `Client message ${String(n)}`,
  sentAt: at(sentAt),
  readAt: read ? Option.some(at(sentAt)) : Option.none(),
});

const fromFirm = (n: number, sentAt: string): Message => ({
  id: messageId(n),
  clientId: client,
  caseId: Option.some(matter),
  author: { _tag: "FromFirm", advocateId: advocate },
  body: `Firm message ${String(n)}`,
  sentAt: at(sentAt),
  readAt: Option.none(),
});

describe("who said it", () => {
  it("names the advocate on a message from the firm", () => {
    const message = fromFirm(1, "2026-08-20T09:00:00Z");

    expect(isFromClient(message)).toBe(false);
    if (message.author._tag === "FromFirm") {
      expect(message.author.advocateId).toBe(advocate);
    }
  });

  /**
   * A message from a client names nobody, and that is the point of the union.
   * The portal login belongs to the client — for a company, an organisation
   * rather than a person — and inventing an individual would attribute words to
   * somebody who may not have written them.
   */
  it("names nobody on a message from the client", () => {
    const message = fromClient(1, "2026-08-20T09:00:00Z");

    expect(isFromClient(message)).toBe(true);
    expect(Object.keys(message.author)).toStrictEqual(["_tag"]);
  });
});

describe("reading a thread", () => {
  it("puts it in the order it was said", () => {
    const later = fromClient(1, "2026-08-20T11:00:00Z");
    const earlier = fromFirm(2, "2026-08-20T09:00:00Z");

    expect(inOrder([later, earlier])).toStrictEqual([earlier, later]);
  });

  it("does not mutate what it is given", () => {
    const later = fromClient(1, "2026-08-20T11:00:00Z");
    const earlier = fromFirm(2, "2026-08-20T09:00:00Z");
    const given = [later, earlier];

    inOrder(given);

    expect(given).toStrictEqual([later, earlier]);
  });
});

describe("who is waiting on us", () => {
  it("reports a client message with nothing said since", () => {
    const thread = [
      fromFirm(1, "2026-08-20T09:00:00Z"),
      fromClient(2, "2026-08-20T10:00:00Z"),
    ];

    const waiting = awaitingReply(thread);
    expect(Option.isSome(waiting)).toBe(true);
    expect(Option.getOrThrow(waiting).id).toBe(messageId(2));
  });

  it("reports nothing once the firm has answered", () => {
    const thread = [
      fromClient(1, "2026-08-20T10:00:00Z"),
      fromFirm(2, "2026-08-20T11:00:00Z"),
    ];

    expect(Option.isNone(awaitingReply(thread))).toBe(true);
  });

  /**
   * **The test this module exists for.**
   *
   * The client's message has been *read* and not answered. Every "unread"
   * badge in the world reports this thread as clear; it is the one most likely
   * to end in a complaint, because somebody at the firm looked at it and moved
   * on.
   */
  it("still reports a message that was read and not answered", () => {
    const thread = [fromClient(1, "2026-08-20T10:00:00Z", true)];

    expect(isRead(thread[0]!)).toBe(true);
    expect(Option.isSome(awaitingReply(thread))).toBe(true);
  });

  /**
   * Three questions in a row is one conversation waiting, not three — and the
   * time it has been waiting is the *first* of them, which is the honest
   * number. Reporting all three would make a queue of ten look like thirty and
   * would be ignored within a week.
   */
  it("counts a run of client messages as one wait, from the earliest", () => {
    const thread = [
      fromFirm(1, "2026-08-20T09:00:00Z"),
      fromClient(2, "2026-08-20T10:00:00Z"),
      fromClient(3, "2026-08-20T10:30:00Z"),
      fromClient(4, "2026-08-20T11:00:00Z"),
    ];

    const waiting = awaitingReply(thread);
    expect(Option.getOrThrow(waiting).id).toBe(messageId(2));
  });

  it("reports nothing for a thread the firm started", () => {
    expect(
      Option.isNone(awaitingReply([fromFirm(1, "2026-08-20T09:00:00Z")])),
    ).toBe(true);
  });

  it("reports nothing for an empty thread", () => {
    expect(Option.isNone(awaitingReply([]))).toBe(true);
  });

  /** Order in the array must not matter; the timestamps decide. */
  it("does not depend on the order it is handed", () => {
    const thread = [
      fromClient(3, "2026-08-20T10:30:00Z"),
      fromFirm(1, "2026-08-20T09:00:00Z"),
      fromClient(2, "2026-08-20T10:00:00Z"),
    ];

    expect(Option.getOrThrow(awaitingReply(thread)).id).toBe(messageId(2));
  });
});

describe("how long they have waited", () => {
  it("counts whole hours", () => {
    const message = fromClient(1, "2026-08-20T09:00:00Z");

    expect(waitingHours(message, at("2026-08-20T11:30:00Z"))).toBe(2);
  });

  /** A clock that disagrees must not produce a negative wait. */
  it("never reports a negative wait", () => {
    const message = fromClient(1, "2026-08-20T09:00:00Z");

    expect(waitingHours(message, at("2026-08-20T08:00:00Z"))).toBe(0);
  });
});

describe("marking read", () => {
  it("records when", () => {
    const read = markRead(
      fromClient(1, "2026-08-20T09:00:00Z"),
      at("2026-08-20T09:05:00Z"),
    );

    expect(Option.getOrThrow(read.readAt)).toStrictEqual(
      at("2026-08-20T09:05:00Z"),
    );
  });

  /**
   * Idempotent by keeping the *first* time. "When did you first see this" has
   * one answer, and a second read is not new information — overwriting it would
   * make a message look freshly seen every time the page was opened.
   */
  it("keeps the first time it was seen", () => {
    const once = markRead(
      fromClient(1, "2026-08-20T09:00:00Z"),
      at("2026-08-20T09:05:00Z"),
    );
    const twice = markRead(once, at("2026-08-21T14:00:00Z"));

    expect(Option.getOrThrow(twice.readAt)).toStrictEqual(
      at("2026-08-20T09:05:00Z"),
    );
  });
});

describe("the unread badge", () => {
  it("counts only what the client sent", () => {
    const thread = [
      fromClient(1, "2026-08-20T10:00:00Z"),
      fromClient(2, "2026-08-20T10:30:00Z", true),
      fromFirm(3, "2026-08-20T11:00:00Z"),
    ];

    expect(unreadFromClient(thread).map((m) => m.id)).toStrictEqual([
      messageId(1),
    ]);
  });
});
