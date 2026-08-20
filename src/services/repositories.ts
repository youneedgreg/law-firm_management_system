import { Context, Effect, Option, Schema } from "effect";
import type * as Audit from "../domain/audit/entry";
import type * as Billing from "../domain/billing/invoice";
import type * as Identity from "../domain/identity/principal";
import type * as Matter from "../domain/case/case";
import type * as Client from "../domain/client/client";
import type * as Firm from "../domain/firm/advocate";
import type * as Ledger from "../domain/trust/ledger";
import type {
  AdvocateId,
  CaseId,
  ClientId,
  InvoiceId,
  UserId,
} from "../domain/shared/ids";
import type * as Money from "../domain/shared/money";

/**
 * Repository interfaces.
 *
 * These live in `services/` and are declared here rather than in `infra/`,
 * which is the whole point of the arrangement: a service depends on the
 * *interface it needs*, and `infra/` supplies an implementation. Nothing in
 * this file knows that Postgres exists, so a test can hand a service an
 * in-memory array and the service cannot tell.
 *
 * The ESLint boundary rules make that structural rather than aspirational —
 * `services/**` cannot import `@/infra/*` at all.
 */

/** Something was looked up by id and was not there. */
export class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
  entity: Schema.String,
  id: Schema.String,
}) {
  get reason(): string {
    return `No ${this.entity} with id ${this.id}`;
  }
}

/** The database refused or failed. Carries the cause without leaking SQL. */
export class RepositoryFailure extends Schema.TaggedError<RepositoryFailure>()(
  "RepositoryFailure",
  { operation: Schema.String, detail: Schema.String },
) {
  get reason(): string {
    return `${this.operation} failed: ${this.detail}`;
  }
}

/**
 * A matter reference the firm has already used.
 *
 * `cases.number` is `UNIQUE`, and the number is derived from what is already
 * stored — so two intakes racing compute the same one and the second loses. The
 * database is the arbiter, exactly as it is for Rule 10: recognising the
 * refusal is the repository's job, and deciding what to do about it is the
 * caller's. `CaseService.open` retries.
 */
export class CaseNumberTaken extends Schema.TaggedError<CaseNumberTaken>()(
  "CaseNumberTaken",
  { number: Schema.String },
) {
  get reason(): string {
    return `Matter reference ${this.number} is already in use`;
  }
}

/**
 * People at the firm.
 *
 * Read-mostly: staff records change rarely, and every matter points at one.
 * It exists as a repository rather than as raw SQL in whatever needs it
 * because `mayAppearInCourt` reads the practising certificate, and a half
 * populated certificate must be refused at the boundary rather than reasoned
 * about downstream.
 */
export interface AdvocateRepository {
  readonly byId: (
    id: AdvocateId,
  ) => Effect.Effect<Firm.Advocate, NotFound | RepositoryFailure>;

  readonly all: () => Effect.Effect<
    readonly Firm.Advocate[],
    RepositoryFailure
  >;

  readonly save: (
    advocate: Firm.Advocate,
  ) => Effect.Effect<Firm.Advocate, RepositoryFailure>;
}

export const AdvocateRepository =
  Context.GenericTag<AdvocateRepository>("AdvocateRepository");

export interface CaseRepository {
  readonly byId: (
    id: CaseId,
  ) => Effect.Effect<Matter.Case, NotFound | RepositoryFailure>;

  readonly findById: (
    id: CaseId,
  ) => Effect.Effect<Option.Option<Matter.Case>, RepositoryFailure>;

  readonly forClient: (
    clientId: ClientId,
  ) => Effect.Effect<readonly Matter.Case[], RepositoryFailure>;

  readonly openMatters: () => Effect.Effect<
    readonly Matter.Case[],
    RepositoryFailure
  >;

  /**
   * The whole caseload, closed matters included.
   *
   * Separate from `openMatters` rather than a parameter on it: that one is
   * shaped to the `cases_by_status` partial index and this one deliberately
   * is not, so a reader can tell from the call site which query runs.
   */
  readonly all: () => Effect.Effect<readonly Matter.Case[], RepositoryFailure>;

  readonly save: (
    matter: Matter.Case,
  ) => Effect.Effect<Matter.Case, CaseNumberTaken | RepositoryFailure>;
}

export const CaseRepository =
  Context.GenericTag<CaseRepository>("CaseRepository");

export interface ClientRepository {
  readonly byId: (
    id: ClientId,
  ) => Effect.Effect<Client.Client, NotFound | RepositoryFailure>;

  readonly all: () => Effect.Effect<
    readonly Client.Client[],
    RepositoryFailure
  >;

  readonly save: (
    client: Client.Client,
  ) => Effect.Effect<Client.Client, RepositoryFailure>;
}

export const ClientRepository =
  Context.GenericTag<ClientRepository>("ClientRepository");

export interface InvoiceRepository {
  readonly byId: (
    id: InvoiceId,
  ) => Effect.Effect<Billing.Invoice, NotFound | RepositoryFailure>;

  readonly forClient: (
    clientId: ClientId,
  ) => Effect.Effect<readonly Billing.Invoice[], RepositoryFailure>;

  readonly save: (
    invoice: Billing.Invoice,
  ) => Effect.Effect<Billing.Invoice, RepositoryFailure>;

  /**
   * Pays an invoice out of the money the firm already holds for that client.
   *
   * Two writes that must not come apart: a payment against the invoice, and the
   * matching withdrawal from the client's trust account. Either one alone is a
   * misstatement — a payment with no withdrawal says the firm was paid from
   * nowhere, and a withdrawal with no payment says client money left the
   * account for no reason. That is the second thing an auditor looks for.
   *
   * Whether the payment is *allowed* is not decided here: the caller checks it
   * against the invoice with `Billing.recordPayment` and picks a Rule 9 purpose
   * for the movement first. This is the operation that makes the two writes
   * atomic, and Rule 10 remains the database's to enforce — hence
   * `TrustAccountUnderfunded` in the error channel, translated from the trigger
   * exactly as `TrustRepository.recordWithdrawal` translates it.
   */
  readonly settleFromTrust: (settlement: {
    readonly invoiceId: InvoiceId;
    readonly payment: Billing.Payment;
    readonly movement: Ledger.TrustMovement;
  }) => Effect.Effect<
    void,
    Ledger.TrustAccountUnderfunded | NotFound | RepositoryFailure
  >;
}

export const InvoiceRepository =
  Context.GenericTag<InvoiceRepository>("InvoiceRepository");

/**
 * The trust ledger.
 *
 * `recordWithdrawal` returns the domain's own `TrustAccountUnderfunded` in its
 * error channel, not a generic database failure. The database enforces Rule 10
 * with a trigger, so a refusal arrives as a Postgres error — the Postgres
 * implementation's job is to recognise that specific refusal and translate it
 * back into the domain error, so callers handle one shape whichever layer
 * caught it.
 */
export interface TrustRepository {
  readonly balanceFor: (
    clientId: ClientId,
  ) => Effect.Effect<Money.Money, RepositoryFailure>;

  readonly movementsFor: (
    clientId: ClientId,
  ) => Effect.Effect<readonly Ledger.TrustMovement[], RepositoryFailure>;

  readonly recordDeposit: (
    movement: Ledger.TrustMovement,
  ) => Effect.Effect<Ledger.TrustMovement, RepositoryFailure>;

  readonly recordWithdrawal: (
    movement: Ledger.TrustMovement,
  ) => Effect.Effect<
    Ledger.TrustMovement,
    Ledger.TrustAccountUnderfunded | RepositoryFailure
  >;

  /** Every client currently overdrawn. Should always be empty. */
  readonly overdrawn: () => Effect.Effect<
    readonly ClientId[],
    RepositoryFailure
  >;
}

export const TrustRepository =
  Context.GenericTag<TrustRepository>("TrustRepository");

/**
 * Logins, and the person behind one.
 *
 * `provision` rather than `create`, and the word is chosen: a login is issued
 * to somebody the firm already knows about. It takes the subject as a tagged
 * value for the same reason `Principal` is a union — there is no way to call
 * this with both an advocate and a client, or with neither.
 *
 * Nothing here touches a password. Better Auth owns the credential and the
 * session (ADR 0004); this owns who the credential *is*, which is the half
 * that has to join to `advocates` and `clients`.
 */
export interface UserRepository {
  /**
   * The principal behind a user id, or `NotFound` if the row is gone.
   *
   * Called on every authenticated request, which is why it is one query rather
   * than a lookup followed by a second one for the staff or client record: the
   * cost falls on every page in the application.
   */
  readonly principalOf: (
    id: UserId,
  ) => Effect.Effect<Identity.Principal, NotFound | RepositoryFailure>;

  readonly byEmail: (
    email: string,
  ) => Effect.Effect<Option.Option<Identity.Principal>, RepositoryFailure>;

  readonly provision: (login: {
    readonly id: UserId;
    readonly name: string;
    readonly email: string;
    readonly subject:
      | { readonly _tag: "Staff"; readonly advocateId: AdvocateId }
      | { readonly _tag: "Client"; readonly clientId: ClientId };
  }) => Effect.Effect<Identity.Principal, RepositoryFailure>;
}

export const UserRepository =
  Context.GenericTag<UserRepository>("UserRepository");

/**
 * The audit trail.
 *
 * Write-and-read-back only: there is no `update` and no `delete`, here or in
 * Postgres, where a trigger refuses both. An interface that offered them would
 * be an interface somebody eventually implements.
 */
export interface AuditRepository {
  readonly record: (
    entry: Audit.AuditEntry,
  ) => Effect.Effect<Audit.AuditEntry, RepositoryFailure>;

  readonly recent: (
    limit: number,
  ) => Effect.Effect<readonly Audit.AuditEntry[], RepositoryFailure>;

  readonly forEntity: (
    entity: Audit.AuditedEntity,
    id: string,
  ) => Effect.Effect<readonly Audit.AuditEntry[], RepositoryFailure>;
}

export const AuditRepository =
  Context.GenericTag<AuditRepository>("AuditRepository");

/**
 * Sessions, as the transport sees them.
 *
 * The one part of authentication that is genuinely somebody else's code: is
 * this cookie a live session, and whose? `handle` passes a request to the
 * sign-in, sign-out and password-reset endpoints and hands back their response.
 *
 * It is declared here, as an interface, so that `IdentityService` can be tested
 * against a fake that answers "yes, this token is user X" with no Better Auth,
 * no cookie parsing and no database — and so that swapping the library out is
 * a change to one file in `infra/` rather than to every service that needs to
 * know who is calling.
 */
export interface SessionGateway {
  /** Whose live session this request carries, if any. */
  readonly identify: (
    headers: Headers,
  ) => Effect.Effect<Option.Option<UserId>, RepositoryFailure>;

  /**
   * Exchanges an email and password for a session.
   *
   * Returns the cookies to set rather than setting them: this layer has no
   * response to write them to, and the two callers that do — a Server Action
   * and a route handler — write them differently. `SessionCookie` is the
   * vocabulary in between, which is why it is a small structured value rather
   * than a raw `Set-Cookie` string somebody would have to parse twice.
   */
  readonly signIn: (credentials: {
    readonly email: string;
    readonly password: string;
  }) => Effect.Effect<SignedIn, InvalidCredentials | RepositoryFailure>;

  /** Ends the session this request carries. Idempotent. */
  readonly signOut: (
    headers: Headers,
  ) => Effect.Effect<readonly SessionCookie[], RepositoryFailure>;

  /** Serves the remaining authentication endpoints — password reset, and any
   * the library adds. */
  readonly handle: (
    request: Request,
  ) => Effect.Effect<Response, RepositoryFailure>;
}

export interface SignedIn {
  readonly userId: UserId;
  readonly cookies: readonly SessionCookie[];
}

/** A cookie to write, in terms neither Better Auth nor Next owns. */
export interface SessionCookie {
  readonly name: string;
  readonly value: string;
  readonly options: {
    readonly httpOnly?: boolean | undefined;
    readonly secure?: boolean | undefined;
    readonly sameSite?: "lax" | "strict" | "none" | undefined;
    readonly path?: string | undefined;
    readonly domain?: string | undefined;
    readonly maxAge?: number | undefined;
    readonly expires?: Date | undefined;
  };
}

/**
 * The email and password did not match.
 *
 * One error for both halves, deliberately: "no such account" and "wrong
 * password" are different facts and telling them apart tells an attacker which
 * addresses are worth attacking. It is the same reasoning as the 404 for an
 * out-of-scope record, applied to the sign-in form.
 */
export class InvalidCredentials extends Schema.TaggedError<InvalidCredentials>()(
  "InvalidCredentials",
  {},
) {
  get reason(): string {
    return "That email address and password do not match an account";
  }
}

export const SessionGateway =
  Context.GenericTag<SessionGateway>("SessionGateway");

/**
 * Runs several writes as one.
 *
 * Declared in `services/` rather than reached for as `sql.withTransaction`,
 * because a service that imported `@effect/sql` to get a transaction would be a
 * service that knows it is stored in SQL — and every one of its tests would
 * need a database to run.
 *
 * What needs it in Phase 6 is the audit entry. A mutation that commits and an
 * audit entry that does not leaves a change nobody made; the two go in
 * together or neither does, and the in-memory implementation enforces the same
 * thing by discarding both on failure.
 */
export interface Transactor {
  readonly transaction: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | RepositoryFailure, R>;
}

export const Transactor = Context.GenericTag<Transactor>("Transactor");
