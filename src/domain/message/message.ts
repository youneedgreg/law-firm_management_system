import { Option, Schema } from "effect";
import { AdvocateId, CaseId, ClientId, MessageId } from "../shared/ids";

/**
 * Messages between a client and the firm.
 *
 * A thread per client, and this module is arranged around one failure: **a
 * client's message that nobody at the firm has answered**. That is what loses
 * clients and generates complaints to the Law Society, and it is invisible in
 * every chat interface ever built — the message is *there*, it looks handled
 * because it has been seen, and nobody replied. `awaitingReply` is this
 * module's `awaitingOutcome`: the report that exists because the ordinary view
 * cannot show it.
 *
 * ## Append-only, like everything else a client can rely on
 *
 * A message cannot be edited or withdrawn. What was said to a client is part of
 * the retainer's history — "you told me on the 14th that the hearing was
 * adjourned" is a claim somebody will make, and a system where the firm can
 * quietly revise its side of that is worse than one with no messages at all.
 * A correction is a new message saying so.
 *
 * ## Why the author is a union rather than a name
 *
 * A message from the firm names the advocate who wrote it. A message from the
 * client names **nobody** — the portal login belongs to the client, which for a
 * company is an organisation rather than a person, and inventing an individual
 * would attribute words to somebody who may not have written them. The two
 * sides genuinely carry different information, and a single nullable
 * `advocateId` beside a `fromClient` boolean would let a row claim both or
 * neither.
 */

export const Author = Schema.Union(
  Schema.TaggedStruct("FromClient", {}),
  Schema.TaggedStruct("FromFirm", { advocateId: AdvocateId }),
);

export type Author = typeof Author.Type;

export const Message = Schema.Struct({
  id: MessageId,
  /** Whose thread it is. Always present: a message is always about a client. */
  clientId: ClientId,
  /**
   * What it is about, where the client said. Absent for a general enquiry —
   * "can you send me last month's invoice again" belongs to no matter, and
   * forcing a choice would make people pick one at random.
   */
  caseId: Schema.Option(CaseId),
  author: Author,
  body: Schema.NonEmptyTrimmedString,
  sentAt: Schema.DateFromSelf,
  /**
   * When the *other* side read it.
   *
   * Not "when it was delivered" and not a boolean. A client asking "did you
   * get my message" is asking a question with a time in the answer, and the
   * firm's own view of a thread needs to distinguish "not read" from "read on
   * the 3rd and not yet answered" — those call for different apologies.
   */
  readAt: Schema.Option(Schema.DateFromSelf),
});

export type Message = typeof Message.Type;

export const isFromClient = (message: Message): boolean =>
  message.author._tag === "FromClient";

export const isRead = (message: Message): boolean =>
  Option.isSome(message.readAt);

/** Oldest first, which is how a conversation reads. */
export const inOrder = (messages: readonly Message[]): readonly Message[] =>
  [...messages].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());

/**
 * Client messages with no reply from the firm after them.
 *
 * **The report this module exists for.** Not "unread" — a message somebody
 * opened and did not answer is worse than one nobody opened, because it looks
 * handled. The test is whether anything from the firm has been said *since*,
 * which is the question a client would ask.
 *
 * Only the client's *latest* run of messages counts: three questions in a row
 * with no answer is one conversation waiting, not three. Returning all three
 * would make a queue of ten look like thirty and would be quietly ignored
 * within a week.
 */
export const awaitingReply = (
  messages: readonly Message[],
): Option.Option<Message> => {
  const ordered = inOrder(messages);

  // Walk back from the end. The first firm message ends the wait.
  let earliest: Option.Option<Message> = Option.none();

  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const message = ordered[index];
    if (message === undefined) continue;
    if (!isFromClient(message)) break;
    earliest = Option.some(message);
  }

  return earliest;
};

/** How long a client has been waiting, in whole hours. */
export const waitingHours = (message: Message, asAt: Date): number =>
  Math.max(
    0,
    Math.floor((asAt.getTime() - message.sentAt.getTime()) / (60 * 60 * 1000)),
  );

/**
 * Marks a message read.
 *
 * Idempotent by keeping the *first* time rather than overwriting it: "when did
 * you first see this" has one answer, and a second read is not new information.
 * The caller decides who is entitled to mark it — the domain only refuses to
 * lose the original timestamp.
 */
export const markRead = (message: Message, at: Date): Message =>
  Option.isSome(message.readAt)
    ? message
    : { ...message, readAt: Option.some(at) };

/** Unread messages from the other side, for a badge. */
export const unreadFromClient = (
  messages: readonly Message[],
): readonly Message[] =>
  messages.filter((message) => isFromClient(message) && !isRead(message));
