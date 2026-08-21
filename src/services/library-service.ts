import { DateTime, Effect, Option, Schema } from "effect";
import * as Matter from "../domain/case/case";
import * as Log from "../domain/firm/contact";
import * as Library from "../domain/firm/precedent";
import type { NotPermitted } from "../domain/identity/permissions";
import type { Principal } from "../domain/identity/principal";
import { CaseId, ClientId, ContactId } from "../domain/shared/ids";
import { AuditLog } from "./audit-service";
import { type CurrentUser, permitted, scope, withinScope } from "./policy";
import {
  AdvocateRepository,
  CaseRepository,
  ClientRepository,
  ContactRepository,
  type NotFound,
  PrecedentRepository,
  type RepositoryFailure,
  Transactor,
} from "./repositories";

/**
 * The firm's own two records: what was said to clients elsewhere, and what the
 * firm keeps on its shelves.
 *
 * One service for two small modules, deliberately. Each is a table, a list and
 * one rule; giving each its own service would be four files of ceremony around
 * about sixty lines of substance, and they are read together — the
 * communications screen and the knowledge screen are both "the firm's own
 * records" rather than anything to do with a matter.
 *
 * The rule in each is the part worth having:
 *
 * - **`neglected`** — clients nobody has been in touch with. A contact log that
 *   only tells you what *did* happen is a diary; the useful question is what
 *   has not.
 * - **`needsReview`** — precedents nobody has checked in a year. A bank's
 *   failure is not being empty, it is being stale, and a 2019 annotated Act
 *   looks exactly like a current one in a list of titles.
 */

// ── What the screens read ─────────────────────────────────────────────────

export interface LoggedContact {
  readonly contact: Log.Contact;
  readonly clientName: string;
  readonly matterNumber: Option.Option<string>;
  readonly loggedByName: string;
}

/** A client and how long since anybody spoke to them. */
export interface Neglected {
  readonly clientId: ClientId;
  readonly clientName: string;
  /** Absent when there has never been any contact at all. */
  readonly lastContact: Option.Option<Date>;
  readonly days: Option.Option<number>;
  readonly openMatters: number;
}

/** Who a conversation can be logged against, and about what. */
export interface ContactChoices {
  readonly clients: readonly {
    readonly id: ClientId;
    readonly name: string;
  }[];
  readonly matters: readonly {
    readonly id: CaseId;
    readonly clientId: ClientId;
    readonly number: string;
    readonly title: string;
  }[];
}

export interface Bank {
  readonly precedents: readonly Library.Precedent[];
  /** Entries nobody has verified within the interval, oldest first. */
  readonly stale: readonly Library.Precedent[];
  readonly asAt: Date;
}

// ── What the boundary accepts ─────────────────────────────────────────────

/**
 * Logging a conversation.
 *
 * `loggedBy` is absent: it is whoever is signed in. A note attributed to a
 * colleague is a claim about them that they did not make — the same rule as a
 * completion, a message and a time entry.
 */
export const LogContact = Schema.Struct({
  clientId: ClientId,
  caseId: Schema.OptionFromNullishOr(CaseId, null),
  channel: Log.Channel,
  direction: Log.Direction,
  summary: Schema.NonEmptyTrimmedString,
  occurredOn: Schema.Date,
});

export type LogContact = typeof LogContact.Type;

// ── Failures this layer adds ──────────────────────────────────────────────

/** Only somebody with a staff record logs a conversation. */
export class NotAContact extends Schema.TaggedError<NotAContact>()(
  "NotAContact",
  { name: Schema.String },
) {
  get reason(): string {
    return `${this.name} has no staff record, so a note cannot be attributed to them`;
  }
}

export type CannotLog =
  | NotPermitted
  | NotFound
  | NotAContact
  | Matter.MatterIsNotTheirs
  | Log.LoggedInTheFuture
  | RepositoryFailure;

// ── Internals ─────────────────────────────────────────────────────────────

const contactId = (): ContactId =>
  Schema.decodeSync(ContactId)(crypto.randomUUID());

/**
 * How long a client can go unheard from before it is worth noticing.
 *
 * Thirty days, and only for clients with an *open matter*. A client whose
 * matter closed last year is not neglected; they are finished, and a list that
 * said otherwise would be ignored within a month.
 */
const QUIET_DAYS = 30;

const days = (of: number) => of * 24 * 60 * 60 * 1000;

const whole = (from: Date, to: Date) =>
  Math.max(0, Math.floor((to.getTime() - from.getTime()) / days(1)));

export class LibraryService extends Effect.Service<LibraryService>()(
  "LibraryService",
  {
    effect: Effect.gen(function* () {
      const contacts = yield* ContactRepository;
      const advocates = yield* AdvocateRepository;
      const precedents = yield* PrecedentRepository;
      const clients = yield* ClientRepository;
      const cases = yield* CaseRepository;
      const audit = yield* AuditLog;
      const transactor = yield* Transactor;

      /** Names for a batch of contacts, resolved once rather than per row. */
      const named = (
        entries: readonly Log.Contact[],
      ): Effect.Effect<
        readonly LoggedContact[],
        RepositoryFailure,
        CurrentUser
      > =>
        Effect.gen(function* () {
          const [everyClient, everyMatter, everyAdvocate] = yield* Effect.all(
            [clients.all(), cases.all(), advocates.all()],
            { concurrency: "unbounded" },
          );

          const clientNames = new Map(
            everyClient.map((client) => [client.id, client.name]),
          );
          const numbers = new Map(
            everyMatter.map((matter) => [matter.id, matter.number]),
          );
          const staff = new Map(
            everyAdvocate.map((advocate) => [advocate.id, advocate.name]),
          );

          return Log.mostRecent(entries).map((contact): LoggedContact => ({
            contact,
            clientName: clientNames.get(contact.clientId) ?? "Unknown client",
            matterNumber: Option.flatMap(contact.caseId, (id) =>
              Option.fromNullable(numbers.get(id)),
            ),
            /**
             * A missing name is shown, not thrown — the foreign key makes it
             * impossible in Postgres, and a log of forty entries should not
             * fail to render because one row is odd.
             */
            loggedByName: staff.get(contact.loggedBy) ?? "Unknown",
          }));
        });

      return {
        /**
         * The firm's log, newest first.
         *
         * Capped, because a contact log is the one table that grows without
         * bound and is read as a *feed* — nobody scrolls to 2019. The cap is a
         * parameter rather than a constant so the client file can ask for one
         * client's whole history without a second operation.
         */
        log: (
          limit = 50,
        ): Effect.Effect<
          readonly LoggedContact[],
          NotPermitted | RepositoryFailure,
          CurrentUser
        > =>
          Effect.gen(function* () {
            yield* permitted("client:read");
            const visible = yield* scope;

            /**
             * A portal user holds `client:read` — for themselves. The firm's
             * contact log is internal: it names other clients, and it is the
             * firm's own notes rather than correspondence the client saw.
             */
            if (visible._tag !== "WholeFirm") return [];

            return yield* named(yield* contacts.recent(limit));
          }),

        /**
         * What the "log a conversation" form can offer.
         *
         * The matters carry their `clientId` so the form can narrow the second
         * dropdown to the client already chosen. Filing a note about one
         * client's matter on another's file is refused by `logContact`, and a
         * form that offered the combination and then refused it would be
         * making the user discover a rule the interface already knew.
         */
        choices: (): Effect.Effect<
          ContactChoices,
          NotPermitted | RepositoryFailure,
          CurrentUser
        > =>
          Effect.gen(function* () {
            yield* permitted("client:write");

            const [everyClient, openMatters] = yield* Effect.all(
              [clients.all(), cases.openMatters()],
              { concurrency: "unbounded" },
            );

            return {
              clients: everyClient
                .map((client) => ({ id: client.id, name: client.name }))
                .sort((a, b) => a.name.localeCompare(b.name)),
              matters: openMatters
                .map((matter) => ({
                  id: matter.id,
                  clientId: matter.clientId,
                  number: matter.number,
                  title: matter.title,
                }))
                .sort((a, b) => a.number.localeCompare(b.number)),
            };
          }),

        /** One client's history, for their file. */
        forClient: (
          clientId: ClientId,
        ): Effect.Effect<
          readonly LoggedContact[],
          NotPermitted | NotFound | RepositoryFailure,
          CurrentUser
        > =>
          Effect.gen(function* () {
            yield* permitted("client:read");
            yield* withinScope("client", clientId, clientId);

            return yield* named(yield* contacts.forClient(clientId));
          }),

        /**
         * Clients with open matters nobody has been in touch with.
         *
         * **The question a contact log exists to answer.** A log of what did
         * happen is a diary; what has *not* happened is the thing a firm loses
         * clients over, and it is invisible in every chronological list.
         *
         * A client who has never been contacted at all sorts first, with
         * `lastContact` absent rather than a fabricated date — "we have never
         * spoken to them" and "we spoke in January" want different reactions.
         */
        neglected: (): Effect.Effect<
          readonly Neglected[],
          NotPermitted | RepositoryFailure,
          CurrentUser
        > =>
          Effect.gen(function* () {
            yield* permitted("client:read");
            const visible = yield* scope;
            if (visible._tag !== "WholeFirm") return [];

            const [everyClient, openMatters, latest, asAt] = yield* Effect.all(
              [
                clients.all(),
                cases.openMatters(),
                contacts.latestPerClient(),
                DateTime.nowAsDate,
              ],
              { concurrency: "unbounded" },
            );

            const load = new Map<string, number>();
            for (const matter of openMatters) {
              load.set(matter.clientId, (load.get(matter.clientId) ?? 0) + 1);
            }

            const spoken = new Map(
              latest.map((contact) => [contact.clientId, contact.occurredOn]),
            );

            return (
              everyClient
                .flatMap((client): readonly Neglected[] => {
                  const open = load.get(client.id) ?? 0;

                  // Not neglected — finished. A closed file is not a silence.
                  if (open === 0) return [];

                  const last = spoken.get(client.id);
                  const quiet =
                    last === undefined ? undefined : whole(last, asAt);

                  if (quiet !== undefined && quiet < QUIET_DAYS) return [];

                  return [
                    {
                      clientId: client.id,
                      clientName: client.name,
                      lastContact: Option.fromNullable(last),
                      days: Option.fromNullable(quiet),
                      openMatters: open,
                    },
                  ];
                })
                /**
                 * Never contacted first, then longest silence. `Option.none`
                 * sorting to the top is the whole reason it is an `Option`: a
                 * client the firm has never spoken to is worse than one it spoke
                 * to a year ago, and any numeric stand-in would have to be
                 * chosen to sort correctly rather than because it was true.
                 */
                .sort((a, b) => {
                  if (Option.isNone(a.days) && Option.isNone(b.days)) {
                    return a.clientName.localeCompare(b.clientName);
                  }
                  if (Option.isNone(a.days)) return -1;
                  if (Option.isNone(b.days)) return 1;
                  return b.days.value - a.days.value;
                })
            );
          }),

        /**
         * Logs a conversation, as whoever is signed in.
         *
         * The matter, where one is named, is checked against the client — the
         * same reasoning as a message: filing a note about one client's matter
         * on another's file puts it in front of the wrong person.
         */
        logContact: (
          input: LogContact,
        ): Effect.Effect<Log.Contact, CannotLog, CurrentUser> =>
          Effect.gen(function* () {
            const principal = yield* permitted("client:write");
            yield* withinScope("client", input.clientId, input.clientId);

            const by = yield* actingAdvocate(principal);
            const client = yield* clients.byId(input.clientId);

            if (Option.isSome(input.caseId)) {
              const matter = yield* cases.byId(input.caseId.value);
              if (matter.clientId !== client.id) {
                return yield* Effect.fail(
                  new Matter.MatterIsNotTheirs({ number: matter.number }),
                );
              }
            }

            const now = yield* DateTime.nowAsDate;

            /**
             * A note about a conversation that has not happened yet is an
             * appointment, and this is not the appointments module. Refused
             * rather than accepted, because a future-dated entry would sit at
             * the top of a log that reads newest-first and stay there.
             */
            if (input.occurredOn.getTime() > now.getTime()) {
              return yield* Effect.fail(
                new Log.LoggedInTheFuture({ occurredOn: input.occurredOn }),
              );
            }

            const contact: Log.Contact = {
              id: contactId(),
              clientId: input.clientId,
              caseId: input.caseId,
              channel: input.channel,
              direction: input.direction,
              loggedBy: by,
              summary: input.summary,
              occurredOn: input.occurredOn,
            };

            return yield* transactor.transaction(
              Effect.gen(function* () {
                const logged = yield* contacts.log(contact);
                yield* audit.record({
                  action: "contact.logged",
                  entity: "contact",
                  entityId: logged.id,
                  after: logged,
                });
                return logged;
              }),
            );
          }),

        /**
         * The precedent bank, with the staleness check applied.
         *
         * Searching happens in the browser over this list rather than as a
         * round trip: a firm's bank is tens of entries, and a request per
         * keystroke to filter forty rows is the wrong trade. Global search,
         * which spans thousands of rows across five tables, is a different
         * problem and gets a different answer.
         */
        bank: (): Effect.Effect<
          Bank,
          NotPermitted | RepositoryFailure,
          CurrentUser
        > =>
          Effect.gen(function* () {
            yield* permitted("case:read");

            const [entries, asAt] = yield* Effect.all([
              precedents.all(),
              DateTime.nowAsDate,
            ]);

            return {
              precedents: entries,
              stale: Library.needsReview(entries, asAt),
              asAt,
            };
          }),
      };
    }),
  },
) {}

/** The staff record behind whoever is signed in. */
const actingAdvocate = (principal: Principal) =>
  principal._tag === "Staff"
    ? Effect.succeed(principal.advocateId)
    : Effect.fail(new NotAContact({ name: principal.name }));
