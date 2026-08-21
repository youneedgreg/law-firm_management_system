import { type Either, Effect, Layer, ManagedRuntime } from "effect";
import { SessionGatewayLive } from "../infra/auth/session-gateway";
import { DocumentStoreLive } from "../infra/blob/store";
import { AdvocateRepositoryLive } from "../infra/sql/advocate-repository";
import { AppointmentRepositoryLive } from "../infra/sql/appointment-repository";
import { AuditRepositoryLive } from "../infra/sql/audit-repository";
import { CaseRepositoryLive } from "../infra/sql/case-repository";
import { PgLive } from "../infra/sql/client";
import { ClientRepositoryLive } from "../infra/sql/client-repository";
import { DocumentRepositoryLive } from "../infra/sql/document-repository";
import { TaskRepositoryLive } from "../infra/sql/task-repository";
import { MessageRepositoryLive } from "../infra/sql/message-repository";
import { ReportRepositoryLive } from "../infra/sql/report-repository";
import { SearchRepositoryLive } from "../infra/sql/search-repository";
import {
  ContactRepositoryLive,
  PrecedentRepositoryLive,
} from "../infra/sql/firm-records-repository";
import { HearingRepositoryLive } from "../infra/sql/hearing-repository";
import { InvoiceRepositoryLive } from "../infra/sql/invoice-repository";
import { TimeRepositoryLive } from "../infra/sql/time-repository";
import { TransactorLive } from "../infra/sql/transactor";
import { TrustRepositoryLive } from "../infra/sql/trust-repository";
import { UserRepositoryLive } from "../infra/sql/user-repository";
import { LoggingLive } from "../infra/telemetry/logging";
import { TracingLive } from "../infra/telemetry/tracing";
import { AuditLog } from "../services/audit-service";
import { BillingService } from "../services/billing-service";
import { CaseService } from "../services/case-service";
import { ClientService } from "../services/client-service";
import { IdentityService } from "../services/identity-service";
import { DocumentService } from "../services/document-service";
import { TaskService } from "../services/task-service";
import { MessageService } from "../services/message-service";
import { NoticeService } from "../services/notice-service";
import { FirmService } from "../services/firm-service";
import { LibraryService } from "../services/library-service";
import { ReportService } from "../services/report-service";
import { SearchService } from "../services/search-service";
import { AppointmentService } from "../services/appointment-service";
import { DashboardService } from "../services/dashboard-service";
import { HearingService } from "../services/hearing-service";
import { TimeService } from "../services/time-service";
import { reported } from "./report";

/**
 * Where the layers meet the framework.
 *
 * This is the only file that knows both that `CaseService` exists and that it
 * is backed by Postgres. Everything above it depends on interfaces; everything
 * below implements them; the wiring lives here and nowhere else, which is what
 * lets the same service run against arrays in a test and against Neon in
 * production without either side being aware of the other.
 *
 * A `ManagedRuntime` rather than `Effect.runPromise` with a Layer at each call
 * site: layers are built once and memoised, so a request does not open a
 * connection pool, and `CaseService` is constructed once rather than per page
 * render.
 */

const repositories = Layer.mergeAll(
  CaseRepositoryLive,
  ClientRepositoryLive,
  AdvocateRepositoryLive,
  InvoiceRepositoryLive,
  HearingRepositoryLive,
  DocumentRepositoryLive,
  UserRepositoryLive,
  AuditRepositoryLive,
  TrustRepositoryLive,
  TimeRepositoryLive,
  TaskRepositoryLive,
  MessageRepositoryLive,
  ContactRepositoryLive,
  PrecedentRepositoryLive,
  ReportRepositoryLive,
  SearchRepositoryLive,
  AppointmentRepositoryLive,
  TransactorLive,
).pipe(Layer.provide(PgLive));

/**
 * Sessions, wired to Better Auth.
 *
 * Beside the repositories rather than among them because it is not one: it
 * reaches the same database, through a different client, over the pool they
 * share. `PgPoolLive` is a single layer value referenced by both `PgLive` and
 * `AuthLive`, so Effect's layer memoisation builds it once and hands the same
 * pool to each — the same trick as the API's shared `memoMap`, and for the same
 * reason.
 */
const sessions = SessionGatewayLive;

/**
 * Document bytes, in Vercel Blob.
 *
 * Beside the repositories rather than among them, because it is not one: it
 * reaches a CDN over HTTP rather than Postgres over a pool, and its failures
 * are `StorageFailure` rather than `RepositoryFailure` precisely so the logs
 * can tell "the database will not answer" from "the blob store will not".
 */
const blob = DocumentStoreLive;

/**
 * Everything a route may ask for.
 *
 * Deliberately only what is wired. A layer listed here that nothing uses is a
 * claim the app does not honour — so there is still no `DocumentService`,
 * because there is no `DocumentRepository` for one to depend on.
 *
 * `TrustRepository` joined in Phase 7 and its arrival is the reason to read
 * this list carefully: it means client money can now be moved by this
 * application, where before the ledger was seeded and then read by nobody.
 * `BillingService` is what moves it, under `trust:write`, and every movement
 * goes through an audit entry inside the same transaction.
 */
/**
 * The services that compose other services.
 *
 * `NoticeService` reads four of the others and stores nothing of its own, so it
 * cannot sit in `AppLayer` beside them — it has to be *given* them. That is the
 * one Layer mistake this codebase can still make silently: a merged layer
 * satisfies the same tags, so getting it wrong compiles and fails at runtime
 * with "Service not found".
 */
const derived = Layer.mergeAll(
  CaseService.Default,
  ClientService.Default,
  BillingService.Default,
  TimeService.Default,
  HearingService.Default,
  DocumentService.Default,
  TaskService.Default,
  MessageService.Default,
  FirmService.Default,
  LibraryService.Default,
  ReportService.Default,
  SearchService.Default,
  AppointmentService.Default,
  AuditLog.Default,
  IdentityService.Default,
).pipe(
  Layer.provide(AuditLog.Default),
  Layer.provide(Layer.mergeAll(repositories, sessions, blob)),
);

/**
 * `NoticeService` and `DashboardService` both read the others and store nothing
 * of their own, so both are *given* `derived` rather than merged beside it.
 * `provideMerge` twice, so the second still sees the first's dependencies.
 */
/**
 * Observability is merged in at the top, and the order matters.
 *
 * `LoggingLive` replaces the default logger and `TracingLive` sets the tracer,
 * and both are *runtime-wide* settings rather than services anybody asks for —
 * so they have to be part of the layer the `ManagedRuntime` is built from, not
 * something a call site provides. Merged rather than provided, because nothing
 * below them depends on them: a repository does not require a logger, it just
 * logs, and whichever logger the runtime holds is the one it gets.
 *
 * Which is also why they are last. Anything built *before* them — a layer's own
 * construction effects, `DatabaseConfig` failing on a bad URL — logs through
 * Effect's default logger, because at that point ours does not exist yet. That
 * is a real gap and a small one: it covers only the first few milliseconds of a
 * process, and the alternative is a bootstrap ordering problem that buys back
 * nothing except those milliseconds.
 */
export const AppLayer = Layer.mergeAll(
  NoticeService.Default,
  DashboardService.Default,
).pipe(
  Layer.provideMerge(derived),
  Layer.merge(LoggingLive),
  Layer.merge(TracingLive),
);

export type AppServices = Layer.Layer.Success<typeof AppLayer>;

/**
 * How building the layers can fail: a missing or malformed `DATABASE_URL`, or a
 * database that will not accept a connection.
 *
 * It stays in the type rather than being swallowed at construction, so it
 * surfaces on the first call that needs the runtime — which is a rejected
 * request with the real reason, not a process that started cleanly and then
 * failed every query with `undefined`.
 */
export type AppStartupFailure = Layer.Layer.Error<typeof AppLayer>;

/**
 * One runtime per process, held on `globalThis`.
 *
 * Next's dev server re-evaluates modules on every edit, so a runtime held in a
 * module-level `const` is rebuilt on each save — and each rebuild opens a fresh
 * pool without closing the last one, until Neon starts refusing connections.
 * The symbol survives module reloads because `globalThis` does.
 *
 * In production this is a plain singleton; the indirection costs one property
 * lookup and removes a class of local-only failure that is miserable to
 * diagnose, because it only appears after twenty edits.
 */
const RUNTIME = Symbol.for("oklaw.runtime");

type AppRuntime = ManagedRuntime.ManagedRuntime<AppServices, AppStartupFailure>;

const holder = globalThis as unknown as { [RUNTIME]?: AppRuntime };

export const runtime: AppRuntime = (holder[RUNTIME] ??=
  ManagedRuntime.make(AppLayer));

/**
 * Runs an effect whose failures are not the caller's to handle.
 *
 * A failure here rejects, which Next turns into the nearest `error.tsx`. That
 * is the right answer for a Server Component read: a page that cannot reach the
 * database has nothing to render, and a component rendering its own "something
 * went wrong" box is a worse version of the boundary the framework already
 * provides.
 */
export const run = <A, E>(
  effect: Effect.Effect<A, E, AppServices>,
): Promise<A> => runtime.runPromise(effect);

/**
 * Runs an effect and hands back its typed failure as a value.
 *
 * For Server Actions, where a refusal is not an exception: "this advocate holds
 * no practising certificate" is an answer the form should show, not a crashed
 * route. `Effect.either` catches the *failure* channel and nothing else, so a
 * defect — the genuinely unexpected — still rejects and still reaches the error
 * boundary. That is the distinction Effect already draws between an error the
 * signature promised and one it did not, and it is exactly the distinction a
 * `try`/`catch` around an action erases.
 *
 * It is also the only boundary that *has* to log. A failure that rejects
 * reaches `onRequestError` with the route it happened on; a failure turned into
 * an `Either` is seen by the action, rendered as a sentence, and then gone. So
 * `reported` sits inside the `either`, and the fourteen `console.error` lines
 * that used to do this one module at a time are gone with it.
 */
export const attempt = <A, E>(
  effect: Effect.Effect<A, E, AppServices>,
): Promise<Either.Either<A, E>> =>
  runtime.runPromise(Effect.either(reported(effect)));
