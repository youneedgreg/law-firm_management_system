import { DateTime, Effect, Either, Schema } from "effect";
import * as Matter from "../domain/case/case";
import * as Court from "../domain/court/court";
import * as Hearing from "../domain/court/hearing";
import type { NotPermitted } from "../domain/identity/permissions";
import { AdvocateId, CaseId, HearingId } from "../domain/shared/ids";
import { AuditLog } from "./audit-service";
import { type CurrentUser, permitted, scope, withinScope } from "./policy";
import {
  AdvocateRepository,
  CaseRepository,
  ClientRepository,
  HearingRepository,
  type NotFound,
  type RepositoryFailure,
  Transactor,
} from "./repositories";

/**
 * The court diary.
 *
 * The whole reason a firm needs a system at all: a missed hearing can mean a
 * matter dismissed for want of prosecution. So this layer is arranged around
 * not losing one, and in particular around the two failure modes that actually
 * happen.
 *
 * **A matter is adjourned and nobody records where it went.** The domain makes
 * that unrepresentable — `Adjourned` carries the date it went to — and Postgres
 * says the same thing with `adjournment_has_destination`. What this layer adds
 * is the *next* step: recording an adjournment offers to list the follow-on
 * hearing, so the matter is on the diary before anybody closes the page.
 *
 * **A hearing date passes and nothing is recorded.** That is either an
 * administrative gap or a missed attendance, and the firm needs to know which
 * before the other side raises it. `diary.awaitingOutcome` is that report, and
 * it is the first thing on the screen rather than something to go looking for.
 */

// ── What the screens read ─────────────────────────────────────────────────

/**
 * The choices a listing form has to offer.
 *
 * Its own type, gated on `hearing:write`, for the reason `BillingChoices`
 * exists: `CaseService.intakeChoices` is gated on `case:open`, which a Legal
 * Assistant does not hold — and a Legal Assistant lists matters for hearing.
 * Borrowing another module's list would mean either loosening that gate or
 * leaving the role that does this job unable to name a matter.
 *
 * Open matters only, and every active member of staff. `mayFile` is *not* here,
 * deliberately: a listing is a diary entry, not an act of filing, and a legal
 * assistant may perfectly well be the person attending a mention.
 */
export interface HearingChoices {
  readonly matters: readonly {
    readonly id: CaseId;
    readonly number: string;
    readonly title: string;
  }[];
  readonly advocates: readonly {
    readonly id: AdvocateId;
    readonly name: string;
    readonly role: string;
  }[];
}

/** A hearing with the two names a diary has to show. */
export interface DiaryEntry {
  readonly hearing: Hearing.Hearing;
  readonly matterNumber: string;
  readonly matterTitle: string;
  readonly clientName: string;
  readonly advocateName: string;
  /** The court, as one line. */
  readonly courtName: string;
}

/**
 * The diary, split at now.
 *
 * Three lists from one clock reading, which is the point of assembling them
 * here: `upcoming` and `awaitingOutcome` are the same query cut at a moment,
 * and computing them separately would let a hearing appear in both or neither
 * depending on how long the two reads took.
 */
export interface Diary {
  /** Past dates with nothing recorded. The report that matters. */
  readonly awaitingOutcome: readonly DiaryEntry[];
  readonly upcoming: readonly DiaryEntry[];
  /** Everything recorded, most recent first. */
  readonly past: readonly DiaryEntry[];
  readonly asAt: Date;
}

// ── What the boundary accepts ─────────────────────────────────────────────

/**
 * Listing a matter.
 *
 * The court is supplied whole rather than assembled from four inputs, for the
 * same reason intake does it: a tagged union cannot express a magistrates'
 * court with no rank, and four free fields can.
 */
export const ListHearing = Schema.Struct({
  caseId: CaseId,
  kind: Hearing.HearingKind,
  court: Court.Court,
  room: Schema.optional(Schema.NonEmptyTrimmedString),
  scheduledFor: Schema.DateFromSelf,
  advocateId: AdvocateId,
});

export type ListHearing = typeof ListHearing.Type;

/**
 * How a hearing went.
 *
 * The domain's own `Outcome`, unchanged — a tagged union in which only
 * `Adjourned` carries a destination, and must. Flattening it into
 * `{ outcome: string, adjournedTo?: Date }` at this boundary would hand back
 * exactly the shape the domain refuses.
 */
export const RecordOutcome = Schema.Struct({
  outcome: Hearing.Outcome,
});

export type RecordOutcome = typeof RecordOutcome.Type;

// ── Failures this layer adds ──────────────────────────────────────────────

/**
 * A matter that is closed is not listed for hearing.
 *
 * Same shape and same reasoning as `MatterIsClosed` in the time module, and
 * deliberately a separate error rather than a shared one: the remedies differ.
 * Time recorded against a closed matter is usually the wrong matter picked from
 * a list; a hearing listed against one usually means the matter was closed too
 * early and should be reopened.
 */
export class MatterNotOpen extends Schema.TaggedError<MatterNotOpen>()(
  "MatterNotOpen",
  { number: Schema.String, status: Schema.String },
) {
  get reason(): string {
    return (
      `${this.number} is ${this.status}, so it cannot be listed for hearing. ` +
      `If the court has listed it, the matter should be reopened first`
    );
  }
}

/** A hearing whose outcome has already been recorded. */
export class OutcomeAlreadyRecorded extends Schema.TaggedError<OutcomeAlreadyRecorded>()(
  "OutcomeAlreadyRecorded",
  { recorded: Schema.String },
) {
  get reason(): string {
    return (
      `This hearing is already recorded as ${this.recorded}. What happened in ` +
      `court is a matter of record and is not overwritten — if it was entered ` +
      `wrongly, that is a correction to make deliberately and with a note`
    );
  }
}

/**
 * A hearing listed in the past.
 *
 * Refused because it is nearly always a mistyped year, and a date behind today
 * puts the matter straight into `awaitingOutcome` where it looks like a missed
 * attendance. Recording a hearing that has *already happened* is a different
 * operation — list it and record the outcome — and both leave a trail.
 */
export class ListedInThePast extends Schema.TaggedError<ListedInThePast>()(
  "ListedInThePast",
  /**
   * `Schema.Date`, for the reason spelled out on `AdjournedIntoThePast`: an
   * error is on the wire too, and `DateFromSelf` encodes to a `Date`, which
   * JSON cannot carry. The type side is still a `Date`, so nothing about
   * raising or reading this changes.
   *
   * The rule this establishes: **an error carrying a date uses `Schema.Date`.**
   * The OpenAPI generator is what enforces it, and it does so at build time
   * rather than on the first refusal that has to be serialised.
   */
  { scheduledFor: Schema.Date },
) {
  get reason(): string {
    return (
      `${this.scheduledFor.toDateString()} has already passed. A hearing ` +
      `listed behind today appears immediately as a missed attendance; check ` +
      `the year`
    );
  }
}

export type CannotList =
  | NotPermitted
  | MatterNotOpen
  | ListedInThePast
  | Court.OutsideCourtJurisdiction
  | Matter.CannotFileWithoutValue
  | NotFound
  | RepositoryFailure;

// ── Helpers ───────────────────────────────────────────────────────────────

const enforce = <A, E>(result: Either.Either<A, E>): Effect.Effect<A, E> =>
  Either.match(result, {
    onLeft: Effect.fail,
    onRight: Effect.succeed<A>,
  });

const hearingId = (): HearingId =>
  Schema.decodeSync(HearingId)(crypto.randomUUID());

// ── The service ───────────────────────────────────────────────────────────

export class HearingService extends Effect.Service<HearingService>()(
  "HearingService",
  {
    effect: Effect.gen(function* () {
      const hearings = yield* HearingRepository;
      const cases = yield* CaseRepository;
      const clients = yield* ClientRepository;
      const advocates = yield* AdvocateRepository;
      const audit = yield* AuditLog;
      const transactor = yield* Transactor;

      /**
       * The hearing, and the matter it belongs to, scoped.
       *
       * A hearing has no client of its own; it belongs to a matter, and the
       * matter belongs to a client. Two hops, and they have to be — otherwise a
       * portal user could read the firm's court diary for somebody else's file.
       */
      const scoped = (id: HearingId) =>
        Effect.gen(function* () {
          const hearing = yield* hearings.byId(id);
          const matter = yield* cases.byId(hearing.caseId);
          yield* withinScope("hearing", id, matter.clientId);
          return { hearing, matter };
        });

      /** Resolves the names a diary line shows. */
      const asEntries = (
        entries: readonly Hearing.Hearing[],
        matters: ReadonlyMap<CaseId, Matter.Case>,
        clientNames: ReadonlyMap<string, string>,
        advocateNames: ReadonlyMap<AdvocateId, string>,
      ): readonly DiaryEntry[] =>
        entries.map((hearing) => {
          const matter = matters.get(hearing.caseId);
          return {
            hearing,
            matterNumber: matter?.number ?? "—",
            matterTitle: matter?.title ?? "Unknown matter",
            clientName:
              matter === undefined
                ? "Unknown client"
                : (clientNames.get(matter.clientId) ?? "Unknown client"),
            advocateName: advocateNames.get(hearing.advocateId) ?? "Unassigned",
            courtName: Court.describe(hearing.court),
          };
        });

      return {
        /** Who and what a listing may name. */
        choices: (): Effect.Effect<
          HearingChoices,
          NotPermitted | RepositoryFailure,
          CurrentUser
        > =>
          Effect.gen(function* () {
            yield* permitted("hearing:write");

            const [openMatters, everyAdvocate] = yield* Effect.all(
              [cases.openMatters(), advocates.all()],
              { concurrency: "unbounded" },
            );

            return {
              matters: openMatters
                .map((matter) => ({
                  id: matter.id,
                  number: matter.number,
                  title: matter.title,
                }))
                .sort((a, b) => a.number.localeCompare(b.number)),
              advocates: everyAdvocate
                .filter((advocate) => advocate.active)
                .map((advocate) => ({
                  id: advocate.id,
                  name: advocate.name,
                  role: advocate.role,
                }))
                .sort((a, b) => a.name.localeCompare(b.name)),
            };
          }),

        /**
         * The whole diary, cut at one moment.
         *
         * The scope is in the query for a portal user: their matters' hearings
         * and nobody else's. The three lists come from one read and one clock
         * reading, so a hearing cannot appear in two of them.
         */
        diary: (): Effect.Effect<
          Diary,
          NotPermitted | NotFound | RepositoryFailure,
          CurrentUser
        > =>
          Effect.gen(function* () {
            yield* permitted("hearing:read");
            const visible = yield* scope;

            const [everything, everyMatter, everyClient, everyAdvocate, asAt] =
              yield* Effect.all(
                [
                  hearings.all(),
                  visible._tag === "WholeFirm"
                    ? cases.all()
                    : cases.forClient(visible.clientId),
                  /**
                   * Scoped in the query, like the matters beside it. Reading
                   * every client's name to label one client's court dates would
                   * be a read this principal has no business making, however
                   * carefully the result was then discarded.
                   */
                  visible._tag === "WholeFirm"
                    ? clients.all()
                    : Effect.map(clients.byId(visible.clientId), (client) => [
                        client,
                      ]),
                  advocates.all(),
                  DateTime.nowAsDate,
                ],
                { concurrency: "unbounded" },
              );

            const matters = new Map(
              everyMatter.map((matter) => [matter.id, matter] as const),
            );

            /**
             * A portal user's diary is filtered by the matters they may see,
             * and those were read by a scoped query — so a hearing on somebody
             * else's matter has no entry in this map and drops out. That is a
             * filter after a read, which everywhere else in this codebase is
             * the thing to avoid; it is acceptable here only because the
             * *matters* were scoped in the query and the hearings carry no
             * client of their own. The moment `hearings` grows enough rows for
             * that to matter, the fix is a `forClient` on this repository.
             */
            const mine = everything.filter((hearing) =>
              matters.has(hearing.caseId),
            );

            const clientNames = new Map<string, string>(
              everyClient.map((client) => [client.id, client.name] as const),
            );

            const advocateNames = new Map(
              everyAdvocate.map(
                (advocate) => [advocate.id, advocate.name] as const,
              ),
            );

            const recorded = mine.filter(Hearing.isRecorded);

            return {
              awaitingOutcome: asEntries(
                Hearing.awaitingOutcome(mine, asAt),
                matters,
                clientNames,
                advocateNames,
              ),
              upcoming: asEntries(
                Hearing.upcoming(mine, asAt),
                matters,
                clientNames,
                advocateNames,
              ),
              past: asEntries(
                [...recorded].sort(
                  (a, b) => b.scheduledFor.getTime() - a.scheduledFor.getTime(),
                ),
                matters,
                clientNames,
                advocateNames,
              ),
              asAt,
            } satisfies Diary;
          }),

        /** Every court date on one matter, oldest first. */
        forCase: (
          caseId: CaseId,
        ): Effect.Effect<
          readonly Hearing.Hearing[],
          NotPermitted | NotFound | RepositoryFailure,
          CurrentUser
        > =>
          Effect.gen(function* () {
            yield* permitted("hearing:read");
            const matter = yield* cases.byId(caseId);
            yield* withinScope("case", caseId, matter.clientId);
            return yield* hearings.forCase(caseId);
          }),

        /**
         * Lists a matter for hearing.
         *
         * Two rules that need a stored fact: the matter must be open, and the
         * court must be one that can hear it. The second reuses `canFileIn` —
         * the same pecuniary check intake runs — because a magistrates' court
         * that could not have heard the claim at filing cannot hear it now
         * either, and having two different answers to that question is worse
         * than having none.
         */
        list: (
          input: ListHearing,
        ): Effect.Effect<Hearing.Hearing, CannotList, CurrentUser> =>
          Effect.gen(function* () {
            yield* permitted("hearing:write");

            const matter = yield* cases.byId(input.caseId);
            yield* withinScope("case", input.caseId, matter.clientId);
            yield* advocates.byId(input.advocateId);

            if (!Matter.isOpen(matter)) {
              return yield* Effect.fail(
                new MatterNotOpen({
                  number: matter.number,
                  status: matter.status,
                }),
              );
            }

            const now = yield* DateTime.nowAsDate;
            if (input.scheduledFor.getTime() < now.getTime()) {
              return yield* Effect.fail(
                new ListedInThePast({ scheduledFor: input.scheduledFor }),
              );
            }

            yield* enforce(Matter.canFileIn(matter, input.court));

            const hearing: Hearing.Hearing = {
              ...input,
              id: hearingId(),
            };

            return yield* transactor.transaction(
              Effect.gen(function* () {
                const saved = yield* hearings.save(hearing);
                yield* audit.record({
                  action: "hearing.scheduled",
                  entity: "hearing",
                  entityId: saved.id,
                  after: saved,
                });
                return saved;
              }),
            );
          }),

        /**
         * Records how a hearing went, and lists the follow-on if it was
         * adjourned.
         *
         * **The adjournment writes two rows, in one transaction**, and that is
         * the whole point of this operation existing rather than two. The
         * failure this system is built to prevent is a matter adjourned with
         * nowhere recorded to have gone — and a design where recording the
         * adjournment and listing the next date are two separate acts is a
         * design where the second one gets forgotten at four o'clock on a
         * Friday. The domain already refuses an `Adjourned` with no
         * destination; this makes the destination *exist* as a diary entry.
         *
         * The follow-on inherits the court, the room and the advocate, because
         * an adjournment is the same matter in the same court on a different
         * day. Its kind is the same too: a mention adjourned is a mention.
         */
        record: (
          id: HearingId,
          input: RecordOutcome,
        ): Effect.Effect<
          {
            readonly hearing: Hearing.Hearing;
            readonly next?: Hearing.Hearing;
          },
          | NotPermitted
          | OutcomeAlreadyRecorded
          | Hearing.AdjournedIntoThePast
          | NotFound
          | RepositoryFailure,
          CurrentUser
        > =>
          Effect.gen(function* () {
            yield* permitted("hearing:write");
            const { hearing } = yield* scoped(id);

            if (hearing.outcome !== undefined) {
              return yield* Effect.fail(
                new OutcomeAlreadyRecorded({
                  recorded: hearing.outcome._tag,
                }),
              );
            }

            const recorded = yield* enforce(
              Hearing.recordOutcome(hearing, input.outcome),
            );

            const next: Hearing.Hearing | undefined =
              input.outcome._tag === "Adjourned"
                ? {
                    id: hearingId(),
                    caseId: hearing.caseId,
                    kind: hearing.kind,
                    court: hearing.court,
                    scheduledFor: input.outcome.adjournedTo,
                    advocateId: hearing.advocateId,
                    ...(hearing.room === undefined
                      ? {}
                      : { room: hearing.room }),
                  }
                : undefined;

            return yield* transactor.transaction(
              Effect.gen(function* () {
                const saved = yield* hearings.save(recorded);
                const listed =
                  next === undefined ? undefined : yield* hearings.save(next);

                yield* audit.record({
                  action: "hearing.recorded",
                  entity: "hearing",
                  entityId: saved.id,
                  before: hearing,
                  after: saved,
                });

                if (listed !== undefined) {
                  yield* audit.record({
                    action: "hearing.scheduled",
                    entity: "hearing",
                    entityId: listed.id,
                    after: listed,
                  });
                }

                return {
                  hearing: saved,
                  ...(listed === undefined ? {} : { next: listed }),
                };
              }),
            );
          }),
      };
    }),
  },
) {}
