import { DateTime, Effect, Either, Schema } from "effect";
import * as Matter from "../domain/case/case";
import * as Limitation from "../domain/case/limitation";
import * as Status from "../domain/case/status";
import * as Client from "../domain/client/client";
import * as Court from "../domain/court/court";
import * as Firm from "../domain/firm/advocate";
import type { NotPermitted } from "../domain/identity/permissions";
import { AdvocateId, CaseId, CaseNumber, ClientId } from "../domain/shared/ids";
import { AuditLog } from "./audit-service";
import { type CurrentUser, permitted, scope, withinScope } from "./policy";
import {
  AdvocateRepository,
  type CaseNumberTaken,
  CaseRepository,
  ClientRepository,
  type NotFound,
  type RepositoryFailure,
  Transactor,
} from "./repositories";

/**
 * Matters, as the application uses them.
 *
 * The repositories below hand back and take `Case` values and nothing else.
 * What this layer adds is the work that spans more than one of them, and the
 * rules that need a *stored* fact to decide:
 *
 * - a matter references a client and an advocate, and a screen shows their
 *   names, so somebody has to resolve them without the page doing three round
 *   trips of its own;
 * - the next matter reference depends on every reference already issued;
 * - whether a court may hear the matter is a domain question, but whether the
 *   assigned advocate may *file* it depends on a practising certificate that
 *   lives in another table.
 *
 * Everything it depends on is an interface declared in `repositories.ts`. That
 * is what makes `case-service.test.ts` run with no database: it provides arrays
 * and this file cannot tell the difference. The live wiring — Postgres — is
 * assembled in `src/runtime/`, and nothing here imports it.
 */

// ── What the screens read ─────────────────────────────────────────────────

/**
 * A matter with the two names a list has to show.
 *
 * Resolved here rather than joined in SQL because the join belongs to nobody:
 * a repository that returned cases-with-client-names would be returning
 * something that is not a `Case`, and the boundary the whole architecture rests
 * on is that repositories deal in domain values.
 */
export interface CaseSummary {
  readonly matter: Matter.Case;
  readonly clientName: string;
  readonly advocateName: string;
}

/** The limitation position, pre-computed for display. */
export interface LimitationView {
  readonly window: Limitation.LimitationWindow;
  readonly daysRemaining: number;
  readonly urgency: Limitation.Urgency;
}

/**
 * Everything the matter file shows, assembled once.
 *
 * `mayBeMovedTo` is here rather than in the component because the state machine
 * is the domain's. A page that hard-coded the list of statuses to offer would be
 * a second copy of `TRANSITIONS`, and the copy that goes stale.
 */
export interface CaseFile {
  readonly matter: Matter.Case;
  readonly client: Client.Client;
  readonly advocate: Firm.Advocate;
  /**
   * Optional rather than required-and-possibly-undefined, which is how every
   * other absent value in this codebase is modelled — `Case.accruedOn`,
   * `Case.court`, `Case.filedOn`. It was the odd one out, and Phase 4 is where
   * that stopped being cosmetic: JSON has no `undefined`, so a required key
   * holding it encodes to an absent key and decodes back to a missing one. A
   * shape that cannot survive its own round trip is the wrong shape.
   */
  readonly limitation?: LimitationView | undefined;
  readonly mayBeMovedTo: readonly Status.CaseStatus[];
}

/**
 * The choices an intake form has to offer, and one fact about each advocate.
 *
 * `mayFile` is computed rather than left to the form, because the rule is
 * `mayAppearInCourt` and it depends on today's date — a form that decided it
 * from `role` alone would be a second, wrong copy of the Advocates Act check
 * the service enforces on submission. The form marks the ones who cannot; the
 * service is still what refuses.
 */
export interface IntakeChoices {
  readonly clients: readonly { readonly id: ClientId; readonly name: string }[];
  readonly advocates: readonly {
    readonly id: AdvocateId;
    readonly name: string;
    readonly role: string;
    readonly mayFile: boolean;
  }[];
}

export interface CaseloadFilter {
  readonly status?: Status.CaseStatus | undefined;
  /** Scopes to one advocate's own matters — the "My cases" view. */
  readonly advocateId?: AdvocateId | undefined;
}

// ── What the boundary accepts ─────────────────────────────────────────────

/**
 * The intake form, as a schema.
 *
 * Declared here rather than in the Server Action so there is exactly one
 * statement of what opening a matter requires. The action's job is to turn
 * `FormData` into this shape; deciding what the shape *is* belongs to the layer
 * that has to honour it.
 *
 * `id`, `number` and `status` are absent on purpose. A caller does not choose
 * an identifier, does not choose a matter reference, and does not open a file
 * in any state other than New — offering those fields would be offering three
 * ways to write a record the firm's conventions say cannot exist.
 */
export const OpenMatter = Schema.Struct({
  title: Schema.NonEmptyTrimmedString,
  type: Matter.MatterType,
  clientId: ClientId,
  advocateId: AdvocateId,
  court: Schema.optional(Court.Court),
  claimValueCents: Schema.optional(Schema.Int.pipe(Schema.nonNegative())),
  underCustomaryLaw: Schema.Boolean,
  accruedOn: Schema.optional(Schema.DateFromSelf),
  limitationBasis: Schema.optional(Limitation.LimitationBasis),
  openedOn: Schema.DateFromSelf,
  filedOn: Schema.optional(Schema.DateFromSelf),
  causeNumber: Schema.optional(Schema.NonEmptyTrimmedString),
});

export type OpenMatter = typeof OpenMatter.Type;

/**
 * The editable fields of an existing matter.
 *
 * `status` is not among them, and neither is `clientId`. A status moves through
 * `transition`, which enforces the state machine; a matter that changed client
 * is not an edit but a different matter, and quietly reassigning one would
 * detach every invoice and trust movement already raised against it.
 *
 * Every field is optional and absence means "leave alone", so a form that
 * submits four fields cannot blank the other six.
 */
export const AmendMatter = Schema.Struct({
  title: Schema.optional(Schema.NonEmptyTrimmedString),
  type: Schema.optional(Matter.MatterType),
  advocateId: Schema.optional(AdvocateId),
  court: Schema.optional(Court.Court),
  claimValueCents: Schema.optional(Schema.Int.pipe(Schema.nonNegative())),
  underCustomaryLaw: Schema.optional(Schema.Boolean),
  accruedOn: Schema.optional(Schema.DateFromSelf),
  limitationBasis: Schema.optional(Limitation.LimitationBasis),
  filedOn: Schema.optional(Schema.DateFromSelf),
  causeNumber: Schema.optional(Schema.NonEmptyTrimmedString),
});

export type AmendMatter = typeof AmendMatter.Type;

// ── Failures this layer adds ──────────────────────────────────────────────

export class AdvocateNotInPractice extends Schema.TaggedError<AdvocateNotInPractice>()(
  "AdvocateNotInPractice",
  { name: Schema.String },
) {
  get reason(): string {
    return (
      `${this.name} is no longer active at the firm, so a matter cannot be ` +
      `assigned to them. Reassign it to someone carrying work`
    );
  }
}

/**
 * The assigned advocate cannot sign or lodge what is being filed.
 *
 * s. 9 and s. 31 of the Advocates Act: only an advocate holding a current
 * practising certificate may act as one. It is checked against *today* rather
 * than against the filing date because filing is something the firm does now,
 * and the certificate on record is the current one — the domain keeps no
 * history of past certificates, so a claim about 2023 would be invented.
 */
export class AdvocateMayNotFile extends Schema.TaggedError<AdvocateMayNotFile>()(
  "AdvocateMayNotFile",
  { name: Schema.String, role: Schema.String },
) {
  get reason(): string {
    return (
      `${this.name} (${this.role}) may not file in court: the Advocates Act ` +
      `requires a current practising certificate, and the record shows none ` +
      `for this year. Assign the matter to an advocate who holds one`
    );
  }
}

/** 999 matters opened in one year, which the reference format cannot number. */
export class MatterReferencesExhausted extends Schema.TaggedError<MatterReferencesExhausted>()(
  "MatterReferencesExhausted",
  { year: Schema.Int },
) {
  get reason(): string {
    return (
      `Every matter reference for ${this.year} (OKL-${this.year}-001 to -999) ` +
      `has been issued. The format needs a fourth digit`
    );
  }
}

/** Everything `open` can fail with, as one name. */
export type CannotOpenMatter =
  | NotPermitted
  | AdvocateNotInPractice
  | AdvocateMayNotFile
  | MatterReferencesExhausted
  | Matter.Inconsistency
  | Matter.CannotFileWithoutValue
  | Court.OutsideCourtJurisdiction
  | CaseNumberTaken
  | NotFound
  | RepositoryFailure;

// ── Helpers ───────────────────────────────────────────────────────────────

/** Lifts a domain `Either` into the error channel, unchanged. */
const enforce = <A, E>(result: Either.Either<A, E>): Effect.Effect<A, E> =>
  Either.match(result, {
    onLeft: Effect.fail,
    onRight: Effect.succeed<A>,
  });

/**
 * The next unused reference for the year the file was opened.
 *
 * The year comes from `openedOn` and not from today: `OKL-2025-098` names the
 * year the firm took the matter on, so a file opened in December and entered in
 * January keeps the year it belongs to.
 *
 * Derived from what is stored rather than from a counter, which is a real race
 * — two intakes at once compute the same number. That is not papered over here:
 * `cases.number` is `UNIQUE`, the second write is refused, and `open` retries.
 * A sequence in the database would remove the race and also hand out gaps on
 * every rolled-back transaction, which is a worse trade for a reference a
 * client sees.
 */
const nextReference = (
  issued: readonly Matter.Case[],
  openedOn: Date,
): Either.Either<CaseNumber, MatterReferencesExhausted> => {
  const year = openedOn.getUTCFullYear();
  const prefix = `OKL-${year}-`;

  const highest = issued.reduce((top, matter) => {
    if (!matter.number.startsWith(prefix)) return top;
    return Math.max(top, Number(matter.number.slice(prefix.length)));
  }, 0);

  return highest >= 999
    ? Either.left(new MatterReferencesExhausted({ year }))
    : Either.right(
        Schema.decodeSync(CaseNumber)(
          `${prefix}${String(highest + 1).padStart(3, "0")}`,
        ),
      );
};

/** The limitation position as at a given day, where one can be computed. */
const limitationAsAt = (
  matter: Matter.Case,
  today: Date,
): LimitationView | undefined => {
  const window = Matter.limitation(matter);
  if (window === undefined) return undefined;

  return {
    window,
    daysRemaining: Limitation.daysRemaining(window, today),
    urgency: Limitation.urgency(window, today),
  };
};

/**
 * Applies an amendment to a matter.
 *
 * Written as an explicit field-by-field merge rather than a spread of the
 * patch, because `exactOptionalPropertyTypes` makes the two different things:
 * spreading `{ court: undefined }` would set the property to `undefined`, and
 * a matter whose court was *cleared* is not the same record as one whose court
 * was left alone. Absent means untouched, here and in the schema above.
 */
const applyAmendment = (
  matter: Matter.Case,
  edits: AmendMatter,
): Matter.Case => ({
  ...matter,
  ...(edits.title === undefined ? {} : { title: edits.title }),
  ...(edits.type === undefined ? {} : { type: edits.type }),
  ...(edits.advocateId === undefined ? {} : { advocateId: edits.advocateId }),
  ...(edits.court === undefined ? {} : { court: edits.court }),
  ...(edits.claimValueCents === undefined
    ? {}
    : { claimValueCents: edits.claimValueCents }),
  ...(edits.underCustomaryLaw === undefined
    ? {}
    : { underCustomaryLaw: edits.underCustomaryLaw }),
  ...(edits.accruedOn === undefined ? {} : { accruedOn: edits.accruedOn }),
  ...(edits.limitationBasis === undefined
    ? {}
    : { limitationBasis: edits.limitationBasis }),
  ...(edits.filedOn === undefined ? {} : { filedOn: edits.filedOn }),
  ...(edits.causeNumber === undefined
    ? {}
    : { causeNumber: edits.causeNumber }),
});

// ── The service ───────────────────────────────────────────────────────────

export class CaseService extends Effect.Service<CaseService>()("CaseService", {
  effect: Effect.gen(function* () {
    const cases = yield* CaseRepository;
    const clients = yield* ClientRepository;
    const advocates = yield* AdvocateRepository;
    const audit = yield* AuditLog;
    const transactor = yield* Transactor;

    /**
     * Checks the assigned advocate, and the court, against the matter as it
     * will be stored.
     *
     * Takes the whole prospective `Case` rather than the form fields so that
     * `open` and `amend` cannot drift: whatever is about to be written is what
     * gets checked. `filing` says whether this write is the act of filing —
     * editing a matter filed three years ago must not demand a certificate for
     * a year that has nothing to do with it.
     */
    const vet = (matter: Matter.Case, options: { readonly filing: boolean }) =>
      Effect.gen(function* () {
        const advocate = yield* advocates.byId(matter.advocateId);

        if (!advocate.active) {
          return yield* Effect.fail(
            new AdvocateNotInPractice({ name: advocate.name }),
          );
        }

        if (matter.court !== undefined) {
          yield* enforce(Matter.canFileIn(matter, matter.court));
        }

        if (options.filing) {
          const today = yield* DateTime.nowAsDate;
          if (!Firm.mayAppearInCourt(advocate, today)) {
            return yield* Effect.fail(
              new AdvocateMayNotFile({
                name: advocate.name,
                role: advocate.role,
              }),
            );
          }
        }

        return yield* enforce(Matter.consistency(matter));
      });

    /**
     * Reads the caseload with the names resolved.
     *
     * Three reads and an in-memory join rather than one SQL join, for the
     * reason given on `CaseSummary`. The cost is bounded by the size of a
     * firm — hundreds of matters and dozens of staff — and the moment that
     * stops being true this is the function to change, not the boundary.
     */
    const caseload = (filter: CaseloadFilter = {}) =>
      Effect.gen(function* () {
        yield* permitted("case:read");
        const visible = yield* scope;

        /**
         * The scope is in the *query*, not in a filter afterwards.
         *
         * A portal user's caseload is `forClient`, so the rows they may not see
         * are never read — there is no array holding another client's matters
         * for a later `.filter` to be forgotten from, and no join that has to
         * be remembered when this function is next edited. The same reasoning
         * applies to the client list beside it: reading every client's name to
         * label one client's matters would be a read the principal has no
         * business making, however carefully the result was then discarded.
         */
        const [matters, everyClient, everyAdvocate] = yield* Effect.all(
          [
            visible._tag === "WholeFirm"
              ? cases.all()
              : cases.forClient(visible.clientId),
            visible._tag === "WholeFirm"
              ? clients.all()
              : Effect.map(clients.byId(visible.clientId), (client) => [
                  client,
                ]),
            advocates.all(),
          ],
          { concurrency: "unbounded" },
        );

        const clientNames = new Map(
          everyClient.map((client) => [client.id, client.name] as const),
        );
        const advocateNames = new Map(
          everyAdvocate.map(
            (advocate) => [advocate.id, advocate.name] as const,
          ),
        );

        return matters
          .filter(
            (matter) =>
              (filter.status === undefined ||
                matter.status === filter.status) &&
              (filter.advocateId === undefined ||
                matter.advocateId === filter.advocateId),
          )
          .map((matter): CaseSummary => ({
            matter,
            /**
             * A missing name is shown, not thrown. The foreign keys make it
             * impossible in Postgres, and a list of forty matters should not
             * fail to render because one row is odd — the placeholder is
             * visible and points at the record to look at.
             */
            clientName: clientNames.get(matter.clientId) ?? "Unknown client",
            advocateName: advocateNames.get(matter.advocateId) ?? "Unassigned",
          }));
      });

    return {
      caseload,

      /**
       * Who a matter may be opened for, and who may carry it.
       *
       * Gated on `case:open` rather than on `case:read`, because that is what
       * this is for. It is also the read that would hand a portal user the
       * firm's entire client list, which is the kind of endpoint that gets
       * added for a dropdown and forgotten.
       */
      intakeChoices: () =>
        Effect.gen(function* () {
          yield* permitted("case:open");

          const [everyClient, everyAdvocate, today] = yield* Effect.all([
            clients.all(),
            advocates.all(),
            DateTime.nowAsDate,
          ]);

          return {
            clients: everyClient
              .map((client) => ({ id: client.id, name: client.name }))
              .sort((a, b) => a.name.localeCompare(b.name)),
            /**
             * Inactive staff are left out entirely rather than shown and
             * refused. Someone who has left the firm is not a choice that was
             * nearly right.
             */
            advocates: everyAdvocate
              .filter((advocate) => advocate.active)
              .map((advocate) => ({
                id: advocate.id,
                name: advocate.name,
                role: advocate.role,
                mayFile: Firm.mayAppearInCourt(advocate, today),
              }))
              .sort((a, b) => a.name.localeCompare(b.name)),
          } satisfies IntakeChoices;
        }),

      /**
       * The matter file: the matter, the two records it names, and the clock.
       *
       * A read by id cannot be scoped in the query — the id is the query — so
       * the check happens on the row that comes back, and a matter belonging to
       * another client is reported as `NotFound`. See `withinScope`: telling a
       * portal user that a matter exists but is not theirs would confirm that
       * the firm acts for whoever it belongs to.
       */
      file: (id: CaseId) =>
        Effect.gen(function* () {
          yield* permitted("case:read");
          const matter = yield* cases.byId(id);
          yield* withinScope("case", id, matter.clientId);

          const [client, advocate, today] = yield* Effect.all([
            clients.byId(matter.clientId),
            advocates.byId(matter.advocateId),
            DateTime.nowAsDate,
          ]);

          return {
            matter,
            client,
            advocate,
            limitation: limitationAsAt(matter, today),
            mayBeMovedTo: Status.allowedFrom(matter.status),
          } satisfies CaseFile;
        }),

      /**
       * Opens a file.
       *
       * The reference is computed from what is already stored and the write can
       * lose that race, so a refusal from the unique index is retried rather
       * than reported: the second attempt reads a caseload that now includes
       * the winner and computes the next number along. Three attempts, because
       * a fourth consecutive collision is not contention any more.
       */
      open: (
        input: OpenMatter,
      ): Effect.Effect<Matter.Case, CannotOpenMatter, CurrentUser> =>
        Effect.gen(function* () {
          yield* permitted("case:open");
          yield* clients.byId(input.clientId);

          const issued = yield* cases.all();
          const number = yield* enforce(nextReference(issued, input.openedOn));

          const matter: Matter.Case = {
            ...input,
            id: Schema.decodeSync(CaseId)(crypto.randomUUID()),
            number,
            status: "New",
          };

          yield* vet(matter, { filing: matter.filedOn !== undefined });

          /**
           * The write and its audit entry, atomically.
           *
           * A matter that exists with no record of who opened it is precisely
           * the gap an audit trail is for, and it is what a crash between two
           * separate statements produces. `Transactor` is an interface, so the
           * in-memory implementation the tests use rolls both back together and
           * the guarantee is testable without Postgres.
           */
          return yield* transactor.transaction(
            Effect.gen(function* () {
              const saved = yield* cases.save(matter);
              yield* audit.record({
                action: "case.opened",
                entity: "case",
                entityId: saved.id,
                after: saved,
              });
              return saved;
            }),
          );
        }).pipe(
          Effect.retry({
            times: 3,
            while: (error) => error._tag === "CaseNumberTaken",
          }),
        ),

      /** Edits a matter's particulars. Status moves through `transition`. */
      amend: (id: CaseId, edits: AmendMatter) =>
        Effect.gen(function* () {
          yield* permitted("case:amend");
          const current = yield* cases.byId(id);
          yield* withinScope("case", id, current.clientId);

          const amended = applyAmendment(current, edits);

          yield* vet(amended, {
            // Only the act of filing needs a current certificate; a later
            // correction to a matter already in court does not re-file it.
            filing:
              current.filedOn === undefined && amended.filedOn !== undefined,
          });

          return yield* transactor.transaction(
            Effect.gen(function* () {
              const saved = yield* cases.save(amended);
              yield* audit.record({
                action: "case.amended",
                entity: "case",
                entityId: saved.id,
                before: current,
                after: saved,
              });
              return saved;
            }),
          );
        }),

      /**
       * Moves a matter through the lifecycle.
       *
       * The rule itself is `Status.transition`; this reads the current status
       * from storage rather than trusting the caller's idea of it, which is what
       * makes a stale form or a double submit fail instead of overwriting.
       */
      transition: (id: CaseId, to: Status.CaseStatus) =>
        Effect.gen(function* () {
          yield* permitted("case:transition");
          const matter = yield* cases.byId(id);
          yield* withinScope("case", id, matter.clientId);

          const moved = yield* enforce(Matter.changeStatus(matter, to));

          return yield* transactor.transaction(
            Effect.gen(function* () {
              const saved = yield* cases.save(moved);
              yield* audit.record({
                action: "case.transitioned",
                entity: "case",
                entityId: saved.id,
                /**
                 * The whole matter rather than just the status, so that
                 * `changes` reports the one field that moved by comparing two
                 * complete records. A snapshot of `{ status }` alone would be
                 * smaller and would quietly lose the ability to answer "what
                 * else was true about this matter at the time".
                 */
                before: matter,
                after: saved,
              });
              return saved;
            }),
          );
        }),
    };
  }),
}) {}
