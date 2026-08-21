import { FetchHttpClient, HttpApiBuilder, HttpServer } from "@effect/platform";
import { Clock, Duration, Effect, Layer } from "effect";
import { OkLawApi } from "@/api/contract";
import { AuthenticationLive } from "@/api/handlers/authentication";
import { BillingHandlers } from "@/api/handlers/billing";
import { DocumentsHandlers } from "@/api/handlers/documents";
import { TasksHandlers } from "@/api/handlers/tasks";
import { MessagesHandlers } from "@/api/handlers/messages";
import { HearingsHandlers } from "@/api/handlers/hearings";
import { TimeHandlers } from "@/api/handlers/time";
import { CasesHandlers } from "@/api/handlers/cases";
import { ClientsHandlers } from "@/api/handlers/clients";
import { SessionHandlers } from "@/api/handlers/session";
import { OpenApiRoute } from "@/api/openapi";
import { makeClient, type OkLawClient } from "@/api/client";
import type * as Billing from "@/domain/billing/invoice";
import type * as Matter from "@/domain/case/case";
import type * as Identity from "@/domain/identity/principal";
import type * as Ledger from "@/domain/trust/ledger";
import type * as Time from "@/domain/time/entry";
import type * as Hearing from "@/domain/court/hearing";
import type * as Documents from "@/domain/document/document";
import type * as Work from "@/domain/work/task";
import type * as Correspondence from "@/domain/message/message";
import { AuditLog } from "@/services/audit-service";
import { BillingService } from "@/services/billing-service";
import { CaseService } from "@/services/case-service";
import { ClientService } from "@/services/client-service";
import { IdentityService } from "@/services/identity-service";
import { DocumentService } from "@/services/document-service";
import { TaskService } from "@/services/task-service";
import { MessageService } from "@/services/message-service";
import { HearingService } from "@/services/hearing-service";
import { TimeService } from "@/services/time-service";
import {
  advocates,
  asAdvocate,
  asFinance,
  asPartner,
  asReceptionist,
  asWanjiku,
  asZenith,
  clients,
  invoices,
  courtDates,
  documents,
  tasks,
  messages,
  matters,
  movements,
  timeEntries,
  TODAY,
} from "./fixtures";
import {
  inMemoryAdvocates,
  inMemoryLimiter,
  inMemoryAudit,
  inMemoryCases,
  inMemoryClients,
  inMemoryBilling,
  inMemoryDocuments,
  inMemoryHearings,
  inMemoryMessages,
  inMemoryTasks,
  inMemoryTime,
  inMemorySessions,
  inMemoryTransactor,
  inMemoryUsers,
} from "./in-memory-repositories";

/**
 * The whole API, running in the test process, with no socket anywhere.
 *
 * `HttpApiBuilder.toWebHandler` produces a `(Request) => Promise<Response>`,
 * and that is the entire deployment surface: the object Next mounts at
 * `/api/[[...path]]` is the object built here, over the same contract and the
 * same handlers. There is no test double of the server, no supertest, no
 * spawned process to wait for and tear down. The only thing swapped is what the
 * repositories read, which is the substitution the architecture was arranged
 * around in the first place.
 *
 * The client is then pointed at that handler by supplying `FetchHttpClient`'s
 * `Fetch` service. So a test calls `client.cases.file({ path: { id } })`, the
 * request is encoded by the contract, routed and decoded by the contract, run
 * through the real service, encoded as a response by the contract, and decoded
 * back by the contract — every layer of the thing under test, and none of the
 * network. **If the server and the client could drift, this is where it would
 * show**, which is the only way the claim "generated from one definition" is
 * worth anything.
 */

/**
 * A clock stopped at `TODAY`.
 *
 * Not optional. `mayAppearInCourt` compares a practising certificate's year
 * against the current one and the fixtures' certificates are 2026, so a suite
 * on the real clock asserts things that quietly become false in January.
 * `Billing.status` is worse: an invoice's "Overdue" is a function of now, so
 * without this the billing tests would pass today and drift one at a time.
 *
 * `TestClock` is the usual answer, but it is a service a *test* enters, and the
 * clock this needs to control is the one inside a Layer built by
 * `toWebHandler`. `Layer.setClock` reaches it; nothing else does.
 */
const stoppedAt = (instant: Date): Clock.Clock => {
  const millis = instant.getTime();
  const nanos = BigInt(millis) * 1_000_000n;

  return {
    [Clock.ClockTypeId]: Clock.ClockTypeId,
    unsafeCurrentTimeMillis: () => millis,
    currentTimeMillis: Effect.succeed(millis),
    unsafeCurrentTimeNanos: () => nanos,
    currentTimeNanos: Effect.succeed(nanos),
    // Nothing in the API sleeps. If something starts to, a test that hangs is
    // a better outcome than one that silently takes the wall-clock duration.
    sleep: (duration: Duration.Duration) =>
      Effect.dieMessage(
        `The API slept for ${Duration.format(duration)} under a stopped clock`,
      ),
  };
};

export interface Firm {
  readonly matters?: readonly Matter.Case[];
  readonly invoices?: readonly Billing.Invoice[];
  /** The trust ledger. Seeded per test, because Rule 10 is about a balance. */
  readonly movements?: readonly Ledger.TrustMovement[];
  readonly time?: readonly Time.TimeEntry[];
  readonly hearings?: readonly Hearing.Hearing[];
  readonly documents?: readonly Documents.Document[];
  readonly tasks?: readonly Work.Task[];
  readonly messages?: readonly Correspondence.Message[];
  /**
   * Who the client is signed in as.
   *
   * Defaults to the managing partner, because that is the principal for which
   * the *other* rules — the Advocates Act, the court's jurisdiction, the
   * transition table — are the thing under test. `null` means no cookie at
   * all, which is what a 401 test wants, and is spelled explicitly so that a
   * forgotten field cannot quietly produce an anonymous request.
   */
  readonly as?: Identity.Principal | null | undefined;
}

/**
 * Everybody the tests can be.
 *
 * Registered whether or not they are the one signed in, because the point of
 * several of these tests is that being *a* valid principal is not enough —
 * Zenith's login is real, and is still refused Wanjiku's matter.
 */
const KNOWN = [
  asPartner,
  asAdvocate,
  asFinance,
  asReceptionist,
  asWanjiku,
  asZenith,
];

/** A token per principal, so a cookie can name one. */
const TOKENS: Readonly<Record<string, string>> = Object.fromEntries(
  KNOWN.map((principal) => [`token-${principal.userId}`, principal.userId]),
);

/** The base URL. Absolute, because `new Request` requires one. */
export const BASE_URL = "http://oklaw.test";

/**
 * Builds the API over arrays, and a client that speaks to it.
 *
 * Returns both the typed client and the raw handler: most tests want the
 * client, and a few want to see the actual status code and body — a generated
 * client that decodes `404` into `NotFound` is exactly what makes it worth
 * checking, separately, that the status really was `404`.
 */
export const runningApi = (firm: Firm = {}) => {
  const signedInAs = firm.as === undefined ? asPartner : firm.as;
  const audit = inMemoryAudit();

  const billing = inMemoryBilling({
    invoices: firm.invoices ?? invoices,
    movements: firm.movements ?? movements,
  });

  const repositories = Layer.mergeAll(
    inMemoryCases(firm.matters ?? matters),
    inMemoryTasks(firm.tasks ?? tasks),
    inMemoryMessages(firm.messages ?? messages),
    inMemoryClients(clients),
    inMemoryAdvocates(advocates),
    billing.both,
    inMemoryTime(firm.time ?? timeEntries),
    inMemoryHearings(firm.hearings ?? courtDates),
    inMemoryDocuments(firm.documents ?? documents).both,
    inMemoryUsers(signedInAs === null ? KNOWN : [...KNOWN, signedInAs]),
    inMemorySessions(TOKENS),
    inMemoryLimiter().layer,
    audit.layer,
    inMemoryTransactor(),
  );

  /**
   * The real middleware, over fake sessions.
   *
   * Worth being precise about what this does and does not cover. It does not
   * verify a signed cookie — that is Better Auth's, and testing it here would
   * be testing the library. It *does* cover everything this codebase wrote:
   * the middleware reads the request's headers, `IdentityService` turns a user
   * id into a principal by looking it up, a request with no cookie is a 401
   * rather than a principal, and every handler then runs as whoever came back.
   */
  const services = Layer.mergeAll(
    CaseService.Default,
    ClientService.Default,
    BillingService.Default,
    TimeService.Default,
    HearingService.Default,
    DocumentService.Default,
    TaskService.Default,
    MessageService.Default,
    IdentityService.Default,
    AuditLog.Default,
  ).pipe(Layer.provide(AuditLog.Default), Layer.provide(repositories));

  const api = HttpApiBuilder.api(OkLawApi).pipe(
    Layer.provide([
      CasesHandlers,
      ClientsHandlers,
      BillingHandlers,
      TimeHandlers,
      HearingsHandlers,
      DocumentsHandlers,
      TasksHandlers,
      MessagesHandlers,
      SessionHandlers,
      AuthenticationLive,
    ]),
    Layer.provide(services),
  );

  const built = HttpApiBuilder.toWebHandler(
    Layer.mergeAll(
      api,
      OpenApiRoute.pipe(Layer.provide(api)),
      HttpServer.layerContext,
      Layer.setClock(stoppedAt(TODAY)),
    ),
  );

  /**
   * `fetch`, if `fetch` went to this handler.
   *
   * The client is built the same way as in production — `HttpApiClient.make`
   * over the contract — and only the transport underneath it is replaced. That
   * is the seam worth choosing: swapping the *client* for a fake would leave
   * the encoding untested, which is the half most likely to be wrong.
   */
  /**
   * The handler, with the session cookie attached on the way in.
   *
   * A browser sends its cookie on every request without being asked, and this
   * is that — the alternative is every test body carrying a header, which is
   * plumbing that says nothing about what the test is for. A `firm.as` of
   * `undefined` sends no cookie at all, which is exactly the arrangement the
   * 401 tests want.
   */
  const handler = (request: Request): Promise<Response> => {
    if (signedInAs === null) return built.handler(request);

    const signed = new Request(request);
    signed.headers.set(
      "cookie",
      `oklaw.session_token=token-${signedInAs.userId}`,
    );

    return built.handler(signed);
  };

  const dispose = built.dispose;

  /** `fetch`, if `fetch` went to this handler. */
  const fetchHandler: typeof fetch = (input, init) =>
    handler(new Request(input as RequestInfo, init));

  const client: Effect.Effect<OkLawClient> = makeClient(BASE_URL).pipe(
    Effect.provide(
      FetchHttpClient.layer.pipe(
        Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchHandler)),
      ),
    ),
  );

  return { client, handler, dispose, recorded: audit.recorded };
};

/** Runs a test body against a freshly built API, then closes it. */
export const withApi = <A, E>(
  body: (client: OkLawClient) => Effect.Effect<A, E>,
  firm: Firm = {},
): Effect.Effect<A, E> =>
  Effect.gen(function* () {
    const api = runningApi(firm);
    return yield* Effect.acquireUseRelease(api.client, body, () =>
      Effect.promise(() => api.dispose()),
    );
  });
