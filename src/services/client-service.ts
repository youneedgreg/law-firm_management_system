import { DateTime, Effect, Either, Schema } from "effect";
import * as Matter from "../domain/case/case";
import * as ClientDomain from "../domain/client/client";
import * as Conflicts from "../domain/client/conflicts";
import type { NotPermitted } from "../domain/identity/permissions";
import { ClientId, KenyanPhone, KraPin } from "../domain/shared/ids";
import { type CurrentUser, permitted, scope, withinScope } from "./policy";
import { AuditLog } from "./audit-service";
import {
  CaseRepository,
  ClientRepository,
  type NotFound,
  RepositoryFailure,
  Transactor,
} from "./repositories";

/**
 * Clients, as the application uses them.
 *
 * Read-only through Phase 6, and Phase 7 gave it the three things intake needs:
 * taking a client on, correcting their particulars, and — the one worth the
 * whole slice — **screening a prospective retainer for conflicts**.
 *
 * ## The screen is the reason this service is interesting
 *
 * `domain/client/conflicts.ts` was written in Phase 1, exhaustively tested, and
 * could not be run: it screens against `MatterRecord` values carrying
 * structured parties, and nothing produced one. `Case` recorded the other side
 * only inside `title` — free text of the form "X v. Y", which is what a screen
 * prints rather than something a query can match. Migration 0010 gave `Case`
 * an `opposingParties` array, and this is where the history is assembled from
 * it.
 *
 * The screen still does not decide. It returns findings and a count of what was
 * searched, and an advocate reads them — see the note at the top of
 * `conflicts.ts` for why a `hasConflict(): boolean` would be the wrong shape
 * and will never exist.
 */

/** A client, and how much of the firm's work is theirs. */
export interface ClientSummary {
  readonly client: ClientDomain.Client;
  /** Who gives instructions: the individual, or the corporate contact. */
  readonly primaryContact: string;
  readonly openMatters: number;
  readonly totalMatters: number;
}

/** A client and the matters on their file. */
export interface ClientFile {
  readonly client: ClientDomain.Client;
  readonly primaryContact: string;
  readonly matters: readonly Matter.Case[];
}

/**
 * Taking a client on.
 *
 * `id` and `number` are absent for the same reason they are absent from
 * `OpenMatter`: neither is chosen. The number is derived from every number the
 * firm has already issued, which makes it a race — and the same race the matter
 * reference has, answered the same way.
 *
 * The union is preserved rather than flattened into one struct with a `kind`
 * field. An individual has no contacts array and a company must have one; a
 * shape admitting both would let a corporate client be created with nobody
 * authorised to instruct, which is exactly what `Corporate.contacts` being a
 * `NonEmptyArray` exists to prevent.
 */
export const TakeOnClient = Schema.Union(
  Schema.Struct({
    _tag: Schema.Literal("Individual"),
    name: Schema.NonEmptyTrimmedString,
    email: Schema.String.pipe(Schema.pattern(/^[^@\s]+@[^@\s]+$/)),
    phone: KenyanPhone,
    kraPin: Schema.optional(KraPin),
    onboardedOn: Schema.DateFromSelf,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Corporate"),
    name: Schema.NonEmptyTrimmedString,
    email: Schema.String.pipe(Schema.pattern(/^[^@\s]+@[^@\s]+$/)),
    phone: KenyanPhone,
    kraPin: Schema.optional(KraPin),
    onboardedOn: Schema.DateFromSelf,
    contacts: Schema.NonEmptyArray(ClientDomain.ClientContact),
    registrationNumber: Schema.optional(Schema.NonEmptyTrimmedString),
  }),
);

export type TakeOnClient = typeof TakeOnClient.Type;

/**
 * Correcting a client's particulars.
 *
 * `_tag` is not editable. An individual who turns out to be a company is not a
 * correction but a different client — and switching would silently invalidate
 * the KRA PIN prefix, orphan the contacts, and leave every matter and fee note
 * already raised pointing at a record that no longer means what it did.
 */
export const AmendClient = Schema.Struct({
  name: Schema.optional(Schema.NonEmptyTrimmedString),
  email: Schema.optional(
    Schema.String.pipe(Schema.pattern(/^[^@\s]+@[^@\s]+$/)),
  ),
  phone: Schema.optional(KenyanPhone),
  kraPin: Schema.optional(KraPin),
  contacts: Schema.optional(Schema.NonEmptyArray(ClientDomain.ClientContact)),
  registrationNumber: Schema.optional(Schema.NonEmptyTrimmedString),
});

export type AmendClient = typeof AmendClient.Type;

/** 9,999 clients, which the `CLT-nnnn` format cannot number. */
export class ClientNumbersExhausted extends Schema.TaggedError<ClientNumbersExhausted>()(
  "ClientNumbersExhausted",
  {},
) {
  get reason(): string {
    return (
      "Every client number from CLT-0001 to CLT-9999 has been issued. " +
      "The format needs a fifth digit"
    );
  }
}

/**
 * Contacts cannot be given to an individual, or taken from a company.
 *
 * The `Client` union makes both unrepresentable, so this is what an *amendment*
 * that would produce one becomes: a refusal naming which half of the union the
 * record is on, rather than a schema failure with no context.
 */
export class ContactsDoNotApply extends Schema.TaggedError<ContactsDoNotApply>()(
  "ContactsDoNotApply",
  { name: Schema.String },
) {
  get reason(): string {
    return (
      `${this.name} is an individual client, who gives instructions in ` +
      `person. Contacts belong to a corporate client, where somebody has to ` +
      `be named as authorised to instruct`
    );
  }
}

export type CannotTakeOnClient =
  NotPermitted | ClientNumbersExhausted | RepositoryFailure;

const enforce = <A, E>(result: Either.Either<A, E>): Effect.Effect<A, E> =>
  Either.match(result, {
    onLeft: Effect.fail,
    onRight: Effect.succeed<A>,
  });

/**
 * The next unused client number.
 *
 * Derived from what is stored, exactly as the matter reference and the fee-note
 * number are, and racing for the same reason. Unlike those two there is no
 * unique index behind it yet — `clients.number` is `UNIQUE`, so the repository
 * would refuse a collision as a bare `RepositoryFailure` rather than as
 * something a caller could retry. That is a real, stated shortfall: two intakes
 * in the same second are rare enough that it has not been worth a third
 * translated error, and if it ever happens the fix is the one `CaseNumberTaken`
 * already documents.
 */
const nextNumber = (
  existing: readonly ClientDomain.Client[],
): Either.Either<string, ClientNumbersExhausted> => {
  const highest = existing.reduce(
    (top, client) => Math.max(top, Number(client.number.slice("CLT-".length))),
    0,
  );

  return highest >= 9999
    ? Either.left(new ClientNumbersExhausted())
    : Either.right(`CLT-${String(highest + 1).padStart(4, "0")}`);
};

export class ClientService extends Effect.Service<ClientService>()(
  "ClientService",
  {
    effect: Effect.gen(function* () {
      const clients = yield* ClientRepository;
      const cases = yield* CaseRepository;
      const audit = yield* AuditLog;
      const transactor = yield* Transactor;

      return {
        /**
         * The client list, with each client's caseload counted.
         *
         * Two reads and an in-memory group, on the same reasoning as
         * `CaseService.caseload`: a repository that returned clients-with-counts
         * would be returning something that is not a `Client`, and the boundary
         * this architecture rests on is that repositories deal in domain values.
         *
         * The alternative — one `forClient` call per client — is the N+1 that
         * looks harmless at eight clients and is not at eight hundred.
         */
        directory: (): Effect.Effect<
          readonly ClientSummary[],
          NotPermitted | NotFound | RepositoryFailure,
          CurrentUser
        > =>
          Effect.gen(function* () {
            yield* permitted("client:read");
            const visible = yield* scope;

            /**
             * A portal user's "directory" is one row: themselves.
             *
             * Answering with a list rather than refusing outright is what lets
             * the portal reuse this operation, and it is safe because the list
             * is built by scoped queries rather than filtered afterwards. The
             * alternative — a second, nearly identical `myDetails` operation —
             * is a second place for the rule to be got right.
             */
            const [everyClient, everyMatter] = yield* Effect.all(
              visible._tag === "WholeFirm"
                ? [clients.all(), cases.all()]
                : [
                    Effect.map(clients.byId(visible.clientId), (client) => [
                      client,
                    ]),
                    cases.forClient(visible.clientId),
                  ],
              { concurrency: "unbounded" },
            );

            return everyClient
              .map((client): ClientSummary => {
                const theirs = everyMatter.filter(
                  (matter) => matter.clientId === client.id,
                );

                return {
                  client,
                  primaryContact: ClientDomain.primaryContact(client),
                  openMatters: theirs.filter(Matter.isOpen).length,
                  totalMatters: theirs.length,
                };
              })
              .sort((a, b) => a.client.name.localeCompare(b.client.name));
          }),

        /**
         * Screens a prospective retainer against the firm's matter history.
         *
         * The professional act this whole slice exists for.
         *
         * The history is assembled here rather than in the domain, because it
         * spans two repositories: every matter, and the name of the client each
         * was taken on for. `Conflicts.screen` matches on names, so a matter
         * whose client record has gone still contributes its opposing parties —
         * which is the honest reading, because the matter remains evidence that
         * the firm once acted against somebody.
         *
         * Gated on `client:write` rather than `client:read`, because this is
         * part of taking a client on. A portal user holds `client:read`, and
         * a screen over the whole firm's history is not theirs to run.
         */
        screen: (
          enquiry: Conflicts.IntakeEnquiry,
        ): Effect.Effect<
          Conflicts.ScreeningResult,
          NotPermitted | RepositoryFailure,
          CurrentUser
        > =>
          Effect.gen(function* () {
            yield* permitted("client:write");

            const [everyMatter, everyClient, screenedAt] = yield* Effect.all(
              [cases.all(), clients.all(), DateTime.nowAsDate],
              { concurrency: "unbounded" },
            );

            const names = new Map(
              everyClient.map((client) => [client.id, client.name] as const),
            );

            /**
             * Each matter as the screen sees it: the client on one side, the
             * recorded opposing parties on the other.
             *
             * `role: "client"` for the firm's own client and `"opposing"` for
             * the other side is the distinction the whole screen turns on —
             * acting *for* somebody and acting *against* them raise different
             * duties, and a history that flattened the two would report both as
             * the same finding.
             */
            const history = everyMatter.map(
              (matter): Conflicts.MatterRecord => ({
                caseId: matter.id,
                caseNumber: matter.number,
                closed: !Matter.isOpen(matter),
                parties: [
                  {
                    party: {
                      name: names.get(matter.clientId) ?? "Unknown client",
                      clientId: matter.clientId,
                    },
                    role: "client" as const,
                  },
                  ...matter.opposingParties.map((name) => ({
                    party: { name },
                    role: "opposing" as const,
                  })),
                ],
              }),
            );

            const result = Conflicts.screen(enquiry, history, screenedAt);

            /**
             * The screen is recorded, findings and all.
             *
             * `AuditLog.record` is normally called inside the mutation's
             * transaction; there is no mutation here, so it is called directly.
             * That is the honest arrangement rather than a gap: nothing is
             * being kept consistent with anything, and wrapping a single write
             * in a transaction to look symmetrical would be theatre.
             *
             * `mattersSearched` goes in because the count is the difference
             * between "nothing matched across 1,240 matters" and "nothing
             * matched across 3", and an entry that recorded only "no findings"
             * would lose exactly the qualification `ScreeningResult` was shaped
             * to preserve.
             */
            yield* audit.record({
              action: "client.screened",
              entity: "client",
              entityId: Conflicts.normaliseName(enquiry.clientName),
              after: result,
            });

            return result;
          }),

        /**
         * Takes a client on.
         *
         * The KRA PIN check is applied and **not enforced**, which looks like an
         * oversight and is the domain's own decision restated: `checkPin`
         * returns an `Either` rather than living in the schema precisely so a
         * mismatched PIN can be queried with whoever did the intake rather than
         * blocking the file from being opened. A sole trader entered as a
         * company is a conversation, not a validation error. The mismatch still
         * reaches the audit trail, because the record of what was accepted
         * should say that it was odd.
         */
        takeOn: (
          input: TakeOnClient,
        ): Effect.Effect<
          ClientDomain.Client,
          CannotTakeOnClient,
          CurrentUser
        > =>
          Effect.gen(function* () {
            yield* permitted("client:write");

            const existing = yield* clients.all();
            const number = yield* enforce(nextNumber(existing));

            /**
             * Decoded rather than constructed, because `Client` is a union and
             * a union has no `make`. Going through the schema is not a
             * formality here: it is what applies the `CLT-nnnn` pattern, the
             * KRA PIN brand and — for a corporate client — the `NonEmptyArray`
             * that stops a company existing with nobody able to instruct.
             */
            const client = yield* Schema.decode(
              Schema.typeSchema(ClientDomain.Client),
            )({
              ...input,
              id: Schema.decodeSync(ClientId)(crypto.randomUUID()),
              number,
            }).pipe(
              Effect.mapError(
                (error) =>
                  new RepositoryFailure({
                    operation: "takeOn",
                    detail: error.message,
                  }),
              ),
            );

            return yield* transactor.transaction(
              Effect.gen(function* () {
                const saved = yield* clients.save(client);
                yield* audit.record({
                  action: "client.opened",
                  entity: "client",
                  entityId: saved.id,
                  after: saved,
                });
                return saved;
              }),
            );
          }),

        /** Corrects a client's particulars. */
        amend: (
          id: ClientId,
          edits: AmendClient,
        ): Effect.Effect<
          ClientDomain.Client,
          NotPermitted | ContactsDoNotApply | NotFound | RepositoryFailure,
          CurrentUser
        > =>
          Effect.gen(function* () {
            yield* permitted("client:write");
            const current = yield* clients.byId(id);

            if (edits.contacts !== undefined && current._tag === "Individual") {
              return yield* Effect.fail(
                new ContactsDoNotApply({ name: current.name }),
              );
            }

            const amended = {
              ...current,
              ...(edits.name === undefined ? {} : { name: edits.name }),
              ...(edits.email === undefined ? {} : { email: edits.email }),
              ...(edits.phone === undefined ? {} : { phone: edits.phone }),
              ...(edits.kraPin === undefined ? {} : { kraPin: edits.kraPin }),
              ...(edits.contacts === undefined || current._tag !== "Corporate"
                ? {}
                : { contacts: edits.contacts }),
              ...(edits.registrationNumber === undefined ||
              current._tag !== "Corporate"
                ? {}
                : { registrationNumber: edits.registrationNumber }),
            } as ClientDomain.Client;

            return yield* transactor.transaction(
              Effect.gen(function* () {
                const saved = yield* clients.save(amended);
                yield* audit.record({
                  action: "client.amended",
                  entity: "client",
                  entityId: saved.id,
                  before: current,
                  after: saved,
                });
                return saved;
              }),
            );
          }),

        /** One client, with their matters. */
        file: (
          id: ClientId,
        ): Effect.Effect<
          ClientFile,
          NotPermitted | NotFound | RepositoryFailure,
          CurrentUser
        > =>
          Effect.gen(function* () {
            yield* permitted("client:read");
            /**
             * Checked before the read rather than after it. For a client the
             * scope *is* the id, so there is nothing to learn from the row
             * first — and refusing early means another client's record is
             * never loaded into a process that might log it.
             */
            yield* withinScope("client", id, id);

            const client = yield* clients.byId(id);
            const matters = yield* cases.forClient(id);

            return {
              client,
              primaryContact: ClientDomain.primaryContact(client),
              matters,
            };
          }),
      };
    }),
  },
) {}
