import { type Either, Effect, Layer, ManagedRuntime } from "effect";
import { SessionGatewayLive } from "../infra/auth/session-gateway";
import { AdvocateRepositoryLive } from "../infra/sql/advocate-repository";
import { AuditRepositoryLive } from "../infra/sql/audit-repository";
import { CaseRepositoryLive } from "../infra/sql/case-repository";
import { PgLive } from "../infra/sql/client";
import { ClientRepositoryLive } from "../infra/sql/client-repository";
import { InvoiceRepositoryLive } from "../infra/sql/invoice-repository";
import { TransactorLive } from "../infra/sql/transactor";
import { UserRepositoryLive } from "../infra/sql/user-repository";
import { AuditLog } from "../services/audit-service";
import { BillingService } from "../services/billing-service";
import { CaseService } from "../services/case-service";
import { ClientService } from "../services/client-service";
import { IdentityService } from "../services/identity-service";

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
  UserRepositoryLive,
  AuditRepositoryLive,
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
 * Everything a route may ask for.
 *
 * Deliberately only what is wired. A layer listed here that nothing uses is a
 * claim the app does not honour — so `TrustRepository` is absent, because no
 * service reads the ledger yet, and there is no `DocumentService` because there
 * is no `DocumentRepository` for one to depend on.
 *
 * `ClientService` and `BillingService` joined in Phase 4. Both are read-only,
 * which is exactly as much as the API offers: their data is real and served
 * from Postgres, and the write paths are Phase 7's along with the rest of those
 * modules. The screens for them still read `lib/data` — the seam Phase 3
 * described has moved, not closed.
 */
export const AppLayer = Layer.mergeAll(
  CaseService.Default,
  ClientService.Default,
  BillingService.Default,
  AuditLog.Default,
  IdentityService.Default,
).pipe(
  Layer.provide(AuditLog.Default),
  Layer.provide(Layer.mergeAll(repositories, sessions)),
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
 */
export const attempt = <A, E>(
  effect: Effect.Effect<A, E, AppServices>,
): Promise<Either.Either<A, E>> => runtime.runPromise(Effect.either(effect));
