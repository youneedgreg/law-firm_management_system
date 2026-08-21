import { Context, Effect, Option, Schema } from "effect";
import type * as Audit from "../domain/audit/entry";
import type * as Billing from "../domain/billing/invoice";
import type * as Identity from "../domain/identity/principal";
import type * as Matter from "../domain/case/case";
import type * as Client from "../domain/client/client";
import type * as Firm from "../domain/firm/advocate";
import type * as Court from "../domain/court/hearing";
import type * as Documents from "../domain/document/document";
import type * as Ledger from "../domain/trust/ledger";
import type * as Time from "../domain/time/entry";
import type * as Work from "../domain/work/task";
import type * as Correspondence from "../domain/message/message";
import type * as Log from "../domain/firm/contact";
import type * as Library from "../domain/firm/precedent";
import type * as Diary from "../domain/diary/appointment";
import type {
  AdvocateId,
  CaseId,
  ClientId,
  DocumentId,
  HearingId,
  InvoiceId,
  MessageId,
  TaskId,
  TimeEntryId,
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
 * A fee-note number the firm has already issued.
 *
 * The same arrangement as `CaseNumberTaken` and for the same reason: `INV-3007`
 * is derived from every number already stored, so two people raising a fee note
 * at the same moment compute the same one. `invoices.number` is `UNIQUE`, the
 * loser is refused, and `BillingService.raise` retries onto the next free
 * number.
 *
 * It is a separate error from `CaseNumberTaken` rather than a shared
 * `NumberTaken` with a field for which sequence: a caller catching one of them
 * is handling one operation, and a single error covering both would compile at
 * call sites that cannot actually produce it.
 */
export class InvoiceNumberTaken extends Schema.TaggedError<InvoiceNumberTaken>()(
  "InvoiceNumberTaken",
  { number: Schema.String },
) {
  get reason(): string {
    return `Fee note number ${this.number} is already in use`;
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

  /**
   * Every fee note the firm has raised.
   *
   * Needed for two things that are both about the whole set rather than one
   * client's: the next invoice number, derived from every number already
   * issued, and the billing screen, which is a view of the firm's receivables.
   */
  readonly all: () => Effect.Effect<
    readonly Billing.Invoice[],
    RepositoryFailure
  >;

  readonly save: (
    invoice: Billing.Invoice,
  ) => Effect.Effect<Billing.Invoice, InvoiceNumberTaken | RepositoryFailure>;

  /**
   * Appends one payment to a fee note.
   *
   * Deliberately not `save` with the payment added to the array. `save`
   * replaces an invoice's payments wholesale, so recording a payment through it
   * is a read, a modification and a write with a gap in the middle — and two
   * clerks banking two cheques against the same invoice at the same time both
   * read the same list, both append their own, and the second write silently
   * discards the first. That is a lost payment, which is the worst defect this
   * module could have: the client has paid and the firm's books say they have
   * not.
   *
   * An append has no such gap. It is also where the M-Pesa confirmation's
   * uniqueness is enforced, by a partial unique index, and translated back into
   * the domain's `PaymentAlreadyRecorded` — the same arrangement as Rule 10's
   * trigger and the `cases.number` index.
   */
  readonly recordPayment: (
    invoiceId: InvoiceId,
    payment: Billing.Payment,
  ) => Effect.Effect<
    void,
    Billing.PaymentAlreadyRecorded | NotFound | RepositoryFailure
  >;

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
 * Documents on a matter file.
 *
 * Versions are append-only in the domain and in Postgres — `document_versions`
 * is keyed on `(document_id, number)`, so a version cannot be replaced by
 * writing over it. `addVersion` is a separate operation from `save` for the
 * same reason `InvoiceRepository.recordPayment` is: a read-modify-write of the
 * whole version list loses one when two people upload at once, and a lost
 * version of a pleading is the copy that was actually filed.
 */
export interface DocumentRepository {
  readonly byId: (
    id: DocumentId,
  ) => Effect.Effect<Documents.Document, NotFound | RepositoryFailure>;

  readonly forCase: (
    caseId: CaseId,
  ) => Effect.Effect<readonly Documents.Document[], RepositoryFailure>;

  readonly all: () => Effect.Effect<
    readonly Documents.Document[],
    RepositoryFailure
  >;

  readonly save: (
    document: Documents.Document,
  ) => Effect.Effect<Documents.Document, RepositoryFailure>;

  /**
   * Appends one version, and refuses to overwrite one that exists.
   *
   * The version number is computed inside the transaction against
   * `(document_id, number)`, so two uploads racing cannot both claim version 4
   * — the primary key refuses the second, which is translated to
   * `VersionAlreadyExists` and retried by the service.
   */
  readonly addVersion: (
    id: DocumentId,
    version: Documents.Version,
  ) => Effect.Effect<void, VersionAlreadyExists | NotFound | RepositoryFailure>;
}

export const DocumentRepository =
  Context.GenericTag<DocumentRepository>("DocumentRepository");

/**
 * Two uploads raced for the same version number.
 *
 * The same arrangement as `CaseNumberTaken`: the number is derived from what is
 * stored, `(document_id, number)` is the primary key, the loser is refused, and
 * the service retries onto the next one. A version silently overwritten would
 * be the version somebody filed.
 */
export class VersionAlreadyExists extends Schema.TaggedError<VersionAlreadyExists>()(
  "VersionAlreadyExists",
  { number: Schema.Int },
) {
  get reason(): string {
    return `Version ${String(this.number)} of this document already exists`;
  }
}

/**
 * Where document bytes live.
 *
 * An interface in `services/` rather than a direct call to `@vercel/blob`, and
 * the reason is the same one every repository here has: a service that imported
 * the Blob SDK would be a service that cannot be tested without a network, and
 * a `DocumentService` test would need a store, a token and an internet
 * connection to assert a permission check.
 *
 * The three operations are the whole of what this system does with bytes.
 * Notably absent is "read the bytes": the application never handles a document
 * body. It hands out a **short-lived signed URL** and the browser fetches
 * directly from the CDN — which is what keeps a 40 MB bundle of pleadings from
 * passing through a serverless function twice.
 */
export interface DocumentStore {
  /** Stores bytes and returns the key they can be fetched back by. */
  readonly put: (
    key: string,
    body: Uint8Array,
    contentType: string,
  ) => Effect.Effect<{ readonly sizeBytes: number }, StorageFailure>;

  /**
   * A URL that will serve this key, for a short time, to whoever holds it.
   *
   * Short-lived because the URL *is* the authorisation once issued — there is
   * no session on a CDN fetch. Fifteen minutes is long enough to open a
   * document and short enough that a URL pasted into a chat is not a permanent
   * grant.
   */
  readonly signedUrl: (key: string) => Effect.Effect<string, StorageFailure>;

  readonly remove: (key: string) => Effect.Effect<void, StorageFailure>;
}

export const DocumentStore = Context.GenericTag<DocumentStore>("DocumentStore");

/**
 * The blob store refused or failed.
 *
 * Separate from `RepositoryFailure` because it is a different dependency with a
 * different failure mode — a database that will not answer and a CDN that will
 * not answer are different operational problems, and a single error would make
 * the logs unable to tell them apart.
 */
export class StorageFailure extends Schema.TaggedError<StorageFailure>()(
  "StorageFailure",
  { operation: Schema.String, detail: Schema.String },
) {
  get reason(): string {
    return `Document storage ${this.operation} failed: ${this.detail}`;
  }
}

/**
 * Court dates.
 *
 * `upcoming` and `awaitingOutcome` are the two reads a firm actually runs, and
 * they are opposite halves of the same partial index: everything with no
 * outcome, either side of today. The second is the report that matters — a
 * hearing whose date has passed with nothing recorded is either an
 * administrative gap or a missed attendance, and the firm needs to know which
 * before the other side raises it.
 */
export interface HearingRepository {
  readonly byId: (
    id: HearingId,
  ) => Effect.Effect<Court.Hearing, NotFound | RepositoryFailure>;

  readonly forCase: (
    caseId: CaseId,
  ) => Effect.Effect<readonly Court.Hearing[], RepositoryFailure>;

  /** Every hearing with no outcome recorded, in date order. */
  readonly pending: () => Effect.Effect<
    readonly Court.Hearing[],
    RepositoryFailure
  >;

  readonly all: () => Effect.Effect<
    readonly Court.Hearing[],
    RepositoryFailure
  >;

  readonly save: (
    hearing: Court.Hearing,
  ) => Effect.Effect<Court.Hearing, RepositoryFailure>;
}

export const HearingRepository =
  Context.GenericTag<HearingRepository>("HearingRepository");

/**
 * Outstanding work.
 *
 * `open` is shaped to the `tasks_open_by_due` partial index — everything not
 * `Done`, by due date — and it is deliberately the *only* list read. The
 * screens then split it into overdue and due-soon against **one clock
 * reading**, in the service, rather than as two queries against two different
 * `now()`s: a task that appeared in both lists, or in neither, depending on how
 * long a second round trip took is exactly the bug the hearing diary already
 * avoids this way.
 *
 * There is no `all()`. A firm accumulates completed tasks indefinitely and
 * nothing asks for them in bulk — a done task is answered for by the audit
 * trail, and by `forCase` when somebody is reading a matter file. An `all()`
 * added for a screen that does not exist is a table scan waiting for a firm
 * with three years of history.
 */
export interface TaskRepository {
  readonly byId: (
    id: TaskId,
  ) => Effect.Effect<Work.Task, NotFound | RepositoryFailure>;

  /** Every task on one matter, done included: a matter file shows both. */
  readonly forCase: (
    caseId: CaseId,
  ) => Effect.Effect<readonly Work.Task[], RepositoryFailure>;

  /** Everything not yet done, in due-date order. */
  readonly open: () => Effect.Effect<readonly Work.Task[], RepositoryFailure>;

  /**
   * How many tasks are still open on a matter.
   *
   * A count rather than a list, because the caller — `CaseService`, about to
   * close a matter — does not want the tasks, it wants to know whether there
   * are any. Closing a matter over the top of "file the decree absolute" is the
   * way that task is never done by anyone.
   */
  readonly openCount: (
    caseId: CaseId,
  ) => Effect.Effect<number, RepositoryFailure>;

  readonly save: (
    task: Work.Task,
  ) => Effect.Effect<Work.Task, RepositoryFailure>;
}

export const TaskRepository =
  Context.GenericTag<TaskRepository>("TaskRepository");

/**
 * Correspondence with clients.
 *
 * `forClient` is the only way to read a thread, and there is deliberately no
 * `byId`. A message is never looked at on its own — it is read in the
 * conversation it belongs to, and an id-based read would be the one that
 * eventually gets called without a scope check.
 *
 * `unanswered` is the report. It reads the *latest* client message per client
 * where nothing from the firm has been said since — one row per waiting client
 * rather than one per unanswered message, because three questions in a row is
 * one conversation waiting and a queue that counted them separately would be
 * ignored within a week.
 *
 * `markRead` takes a set rather than one id: a thread is opened all at once,
 * and a loop of updates can half-succeed, leaving some of what somebody plainly
 * saw recorded as unseen.
 */
export interface MessageRepository {
  readonly forClient: (
    clientId: ClientId,
  ) => Effect.Effect<readonly Correspondence.Message[], RepositoryFailure>;

  /** The oldest unanswered message per client, newest wait last. */
  readonly unanswered: () => Effect.Effect<
    readonly Correspondence.Message[],
    RepositoryFailure
  >;

  readonly send: (
    message: Correspondence.Message,
  ) => Effect.Effect<Correspondence.Message, RepositoryFailure>;

  /**
   * Records that these messages were read, at this moment.
   *
   * Answers how many rows it actually changed. Already-read messages are
   * skipped by the `WHERE`, so the count is the number newly seen — which is
   * what the caller wants to know and what the database is entitled to decide.
   */
  readonly markRead: (
    ids: readonly MessageId[],
    at: Date,
  ) => Effect.Effect<number, RepositoryFailure>;
}

export const MessageRepository =
  Context.GenericTag<MessageRepository>("MessageRepository");

/**
 * The contact log — notes about conversations that happened elsewhere.
 *
 * No `byId`, for the same reason `MessageRepository` has none: an entry is read
 * in the log it belongs to, and an id-based read is the one that eventually
 * gets called without a scope check.
 *
 * `latestPerClient` is one `DISTINCT ON`, not a query per client. Answering
 * "who have we not spoken to" by asking six times is the shape that looks fine
 * on seed data and is forty round trips against a real client list.
 */
export interface ContactRepository {
  readonly forClient: (
    clientId: ClientId,
  ) => Effect.Effect<readonly Log.Contact[], RepositoryFailure>;

  /** The firm's whole log, newest first, capped. */
  readonly recent: (
    limit: number,
  ) => Effect.Effect<readonly Log.Contact[], RepositoryFailure>;

  /** The most recent contact with each client, for "who have we neglected". */
  readonly latestPerClient: () => Effect.Effect<
    readonly Log.Contact[],
    RepositoryFailure
  >;

  readonly log: (
    contact: Log.Contact,
  ) => Effect.Effect<Log.Contact, RepositoryFailure>;
}

export const ContactRepository =
  Context.GenericTag<ContactRepository>("ContactRepository");

/**
 * The precedent bank.
 *
 * `all()` and `save`, and nothing more. Search and the staleness check run in
 * the domain over the whole list — a firm's bank is tens of entries, and
 * pushing either into SQL would put "is this still good law" in two places that
 * eventually disagree about the interval.
 */
export interface PrecedentRepository {
  readonly all: () => Effect.Effect<
    readonly Library.Precedent[],
    RepositoryFailure
  >;

  readonly save: (
    precedent: Library.Precedent,
  ) => Effect.Effect<Library.Precedent, RepositoryFailure>;
}

export const PrecedentRepository = Context.GenericTag<PrecedentRepository>(
  "PrecedentRepository",
);

/**
 * Appointments — the third diary.
 *
 * `forAdvocateOn` serves both callers that exist: the clash check, which needs
 * one advocate's day before a booking is accepted, and the diary view, which
 * shows it. A day rather than an arbitrary range, because a range parameter
 * nobody passes anything but a day to is one that eventually gets passed
 * something else.
 */
export interface AppointmentRepository {
  /** Everything not yet finished, soonest first. */
  readonly upcoming: () => Effect.Effect<
    readonly Diary.Appointment[],
    RepositoryFailure
  >;

  readonly forAdvocateOn: (
    advocateId: AdvocateId,
    day: Date,
  ) => Effect.Effect<readonly Diary.Appointment[], RepositoryFailure>;

  readonly save: (
    appointment: Diary.Appointment,
  ) => Effect.Effect<Diary.Appointment, RepositoryFailure>;
}

export const AppointmentRepository = Context.GenericTag<AppointmentRepository>(
  "AppointmentRepository",
);

/**
 * Recorded work.
 *
 * `forCase` and `unbilled` look like the same query with a filter, and are kept
 * apart for the reason `CaseRepository` keeps `openMatters` apart from `all`:
 * `unbilled` is shaped to the `time_entries_unbilled` partial index and this one
 * deliberately is not, so a reader can tell from the call site which runs.
 *
 * `carryOnto` is the interesting one. It moves a set of entries onto a fee note
 * as a single statement, because the alternative — a loop of updates — can
 * half-succeed, and half a fee note's worth of time marked as billed is work
 * that will never be billed by anyone. It refuses the whole set if any entry
 * has already been carried, which the `WHERE invoice_id IS NULL` makes atomic:
 * two people generating a fee note from the same matter at the same moment
 * cannot both claim the same hours.
 */
export interface TimeRepository {
  readonly byId: (
    id: TimeEntryId,
  ) => Effect.Effect<Time.TimeEntry, NotFound | RepositoryFailure>;

  readonly forCase: (
    caseId: CaseId,
  ) => Effect.Effect<readonly Time.TimeEntry[], RepositoryFailure>;

  readonly forAdvocate: (
    advocateId: AdvocateId,
  ) => Effect.Effect<readonly Time.TimeEntry[], RepositoryFailure>;

  /** Billable work not yet on a fee note, for one matter or the whole firm. */
  readonly unbilled: (
    caseId?: CaseId,
  ) => Effect.Effect<readonly Time.TimeEntry[], RepositoryFailure>;

  readonly recent: (
    limit: number,
  ) => Effect.Effect<readonly Time.TimeEntry[], RepositoryFailure>;

  readonly save: (
    entry: Time.TimeEntry,
  ) => Effect.Effect<Time.TimeEntry, RepositoryFailure>;

  /**
   * Marks a set of entries as billed on one fee note, all or nothing.
   *
   * Returns how many were actually claimed. A caller that asked for six and
   * gets five has lost a race, and the difference is the signal — the count is
   * not decoration, it is how the service knows to fail rather than to raise a
   * fee note for the wrong amount.
   */
  readonly carryOnto: (
    invoiceId: InvoiceId,
    entries: readonly TimeEntryId[],
  ) => Effect.Effect<number, RepositoryFailure>;
}

export const TimeRepository =
  Context.GenericTag<TimeRepository>("TimeRepository");

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
