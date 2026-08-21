import { DateTime, Effect, Option, Schema } from "effect";
import type { NotPermitted } from "../domain/identity/permissions";
import type { Principal } from "../domain/identity/principal";
import * as Matter from "../domain/case/case";
import * as Correspondence from "../domain/message/message";
import { CaseId, ClientId, MessageId } from "../domain/shared/ids";
import { AuditLog } from "./audit-service";
import { type CurrentUser, permitted, scope, withinScope } from "./policy";
import {
  AdvocateRepository,
  CaseRepository,
  ClientRepository,
  MessageRepository,
  type NotFound,
  type RepositoryFailure,
  Transactor,
} from "./repositories";

/**
 * Correspondence between a client and the firm.
 *
 * ## The one thing this exists to prevent
 *
 * **A client's question that nobody answered.** Not "unread" — a message
 * somebody opened and did not reply to is worse, because it looks handled.
 * `waiting()` is the firm's version of the court diary's `awaitingOutcome`: a
 * report that exists because the ordinary view of the data cannot show it, and
 * the reason both modules have one is that the failure is silent.
 *
 * ## Who the message is from is never a parameter
 *
 * `send` takes a body and a client, and works out the author from whoever is
 * signed in. A member of staff sending as a client, or as another advocate,
 * is not a feature anybody asked for and is the kind of thing that ends up in a
 * complaint bundle. The same reasoning that keeps a fee-earner dropdown off the
 * timesheet, applied to something a client will actually read.
 *
 * ## Both sides are bound by the same rules
 *
 * A message cannot be edited or withdrawn by either side. The portal user is
 * not an exception to a rule that binds the firm, and the firm is not an
 * exception to one that binds the client — which is the only arrangement a
 * client has reason to trust.
 */

// ── What the screens read ─────────────────────────────────────────────────

/** A message with the names its ids stand for. */
export interface ThreadEntry {
  readonly message: Correspondence.Message;
  /** The advocate who wrote it, or absent when the client did. */
  readonly authorName: Option.Option<string>;
  /** The matter it is about, where the sender said. */
  readonly matterNumber: Option.Option<string>;
}

export interface Thread {
  readonly clientId: ClientId;
  readonly clientName: string;
  readonly entries: readonly ThreadEntry[];
  /** Unread messages from the client. Zero when read as the client. */
  readonly unread: number;
}

/** One waiting client, and how long they have waited. */
export interface Waiting {
  readonly clientId: ClientId;
  readonly clientName: string;
  readonly since: Date;
  readonly hours: number;
  readonly body: string;
  /** Read and not answered, which is the worse of the two. */
  readonly seen: boolean;
}

// ── What the boundary accepts ─────────────────────────────────────────────

/**
 * Sending a message.
 *
 * No author, and no `sentAt`. Both are facts about the request rather than
 * choices — see the note above.
 *
 * `clientId` is present even for a portal user, whose scope makes it
 * redundant, because the same operation serves both sides and a version that
 * inferred the client would only work for one of them. A portal user naming
 * somebody else's thread is refused by the scope check, as `NotFound`.
 */
export const SendMessage = Schema.Struct({
  clientId: ClientId,
  caseId: Schema.OptionFromNullishOr(CaseId, null),
  body: Schema.NonEmptyTrimmedString,
});

export type SendMessage = typeof SendMessage.Type;

// ── Failures this layer adds ──────────────────────────────────────────────

/**
 * A message about a matter that is not the client's.
 *
 * The domain's error — see `Matter.MatterIsNotTheirs`. A type-only re-export,
 * because a `const` alias is a module-evaluation-time dereference and that
 * broke once already.
 */
export type MatterIsNotTheirs = Matter.MatterIsNotTheirs;

export type CannotSend =
  NotPermitted | NotFound | MatterIsNotTheirs | RepositoryFailure;

// ── The service ───────────────────────────────────────────────────────────

const messageId = (): MessageId =>
  Schema.decodeSync(MessageId)(crypto.randomUUID());

/** The author, from whoever is signed in. Never from the request. */
const authorOf = (principal: Principal): Correspondence.Author =>
  principal._tag === "Staff"
    ? { _tag: "FromFirm", advocateId: principal.advocateId }
    : { _tag: "FromClient" };

export class MessageService extends Effect.Service<MessageService>()(
  "MessageService",
  {
    effect: Effect.gen(function* () {
      const messages = yield* MessageRepository;
      const clients = yield* ClientRepository;
      const cases = yield* CaseRepository;
      const advocates = yield* AdvocateRepository;
      const audit = yield* AuditLog;
      const transactor = yield* Transactor;

      return {
        /**
         * One client's thread.
         *
         * **Opening it marks the client's messages read**, and only when a
         * member of staff opens it. A client opening their own thread does not
         * mark their own messages as seen by the firm — which sounds obvious
         * and is exactly the bug a single "mark this thread read" would
         * produce, quietly emptying the firm's queue every time a client
         * refreshed the page.
         */
        thread: (
          clientId: ClientId,
        ): Effect.Effect<
          Thread,
          NotPermitted | NotFound | RepositoryFailure,
          CurrentUser
        > =>
          Effect.gen(function* () {
            const principal = yield* permitted("message:read");
            yield* withinScope("client", clientId, clientId);

            const [client, held, everyAdvocate, now] = yield* Effect.all(
              [
                clients.byId(clientId),
                messages.forClient(clientId),
                advocates.all(),
                DateTime.nowAsDate,
              ],
              { concurrency: "unbounded" },
            );

            const unread = Correspondence.unreadFromClient(held);

            if (principal._tag === "Staff" && unread.length > 0) {
              yield* messages.markRead(
                unread.map((message) => message.id),
                now,
              );
            }

            const names = new Map(
              everyAdvocate.map((advocate) => [advocate.id, advocate.name]),
            );

            /**
             * Matter numbers for the matters this thread names, and no others.
             * A general enquiry names none, which is why this is a lookup
             * rather than a join.
             */
            const referenced = yield* Effect.forEach(
              [
                ...new Set(
                  held.flatMap((message) =>
                    Option.isSome(message.caseId) ? [message.caseId.value] : [],
                  ),
                ),
              ],
              (id) =>
                Effect.map(
                  cases.byId(id),
                  (matter) => [id, matter.number] as const,
                ),
              { concurrency: "unbounded" },
            );
            const numbers = new Map(referenced);

            return {
              clientId,
              clientName: client.name,
              entries: Correspondence.inOrder(held).map(
                (message): ThreadEntry => ({
                  message,
                  authorName:
                    message.author._tag === "FromFirm"
                      ? Option.fromNullable(
                          names.get(message.author.advocateId),
                        )
                      : Option.none(),
                  matterNumber: Option.flatMap(message.caseId, (id) =>
                    Option.fromNullable(numbers.get(id)),
                  ),
                }),
              ),
              // The count *before* this read marked them, so the screen can
              // say what was waiting when it was opened.
              unread: principal._tag === "Staff" ? unread.length : 0,
            };
          }),

        /**
         * Every client waiting on a reply, longest first.
         *
         * Staff only, and not scoped: it is a view of the firm's obligations
         * rather than of any one client's file. A portal user asking would be
         * asking how long *other* clients have waited.
         */
        waiting: (): Effect.Effect<
          readonly Waiting[],
          NotPermitted | RepositoryFailure,
          CurrentUser
        > =>
          Effect.gen(function* () {
            yield* permitted("message:read");
            const visible = yield* scope;

            /**
             * A portal user holds `message:read` and would otherwise get the
             * firm's whole queue. Answering with an empty list rather than a
             * refusal, because nothing is being concealed — a client genuinely
             * has no queue of their own, and the screen that calls this is not
             * one they can reach.
             */
            if (visible._tag !== "WholeFirm") return [];

            const [oldest, everyClient, now] = yield* Effect.all(
              [messages.unanswered(), clients.all(), DateTime.nowAsDate],
              { concurrency: "unbounded" },
            );

            const names = new Map(
              everyClient.map((client) => [client.id, client.name]),
            );

            return oldest
              .map((message): Waiting => ({
                clientId: message.clientId,
                clientName: names.get(message.clientId) ?? "Unknown client",
                since: message.sentAt,
                hours: Correspondence.waitingHours(message, now),
                body: message.body,
                seen: Correspondence.isRead(message),
              }))
              .sort((a, b) => b.hours - a.hours);
          }),

        /**
         * Sends a message, as whoever is signed in.
         *
         * The matter, when one is named, is checked against the *client* rather
         * than against the sender's scope. Those differ for staff — an advocate
         * may see every matter — and filing a message about the Zenith matter
         * into General Innovations' thread would put it in front of the wrong
         * client, which is a disclosure rather than a typo.
         */
        send: (
          input: SendMessage,
        ): Effect.Effect<Correspondence.Message, CannotSend, CurrentUser> =>
          Effect.gen(function* () {
            const principal = yield* permitted("message:write");
            yield* withinScope("client", input.clientId, input.clientId);

            const client = yield* clients.byId(input.clientId);

            if (Option.isSome(input.caseId)) {
              const matter = yield* cases.byId(input.caseId.value);
              if (matter.clientId !== client.id) {
                return yield* Effect.fail(
                  new Matter.MatterIsNotTheirs({ number: matter.number }),
                );
              }
            }

            const sentAt = yield* DateTime.nowAsDate;

            const message: Correspondence.Message = {
              id: messageId(),
              clientId: input.clientId,
              caseId: input.caseId,
              author: authorOf(principal),
              body: input.body,
              sentAt,
              readAt: Option.none(),
            };

            return yield* transactor.transaction(
              Effect.gen(function* () {
                const sent = yield* messages.send(message);
                yield* audit.record({
                  action: "message.sent",
                  entity: "message",
                  entityId: sent.id,
                  /**
                   * The body is in the snapshot deliberately. "What was said to
                   * this client, and when" is the question asked after a
                   * complaint, and an entry recording only that *a* message
                   * was sent cannot answer it.
                   */
                  after: sent,
                });
                return sent;
              }),
            );
          }),
      };
    }),
  },
) {}
