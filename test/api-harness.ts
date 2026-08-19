import { FetchHttpClient, HttpApiBuilder, HttpServer } from "@effect/platform";
import { Clock, Duration, Effect, Layer } from "effect";
import { OkLawApi } from "@/api/contract";
import { BillingHandlers } from "@/api/handlers/billing";
import { CasesHandlers } from "@/api/handlers/cases";
import { ClientsHandlers } from "@/api/handlers/clients";
import { OpenApiRoute } from "@/api/openapi";
import { makeClient, type OkLawClient } from "@/api/client";
import type * as Billing from "@/domain/billing/invoice";
import type * as Matter from "@/domain/case/case";
import { BillingService } from "@/services/billing-service";
import { CaseService } from "@/services/case-service";
import { ClientService } from "@/services/client-service";
import { advocates, clients, invoices, matters, TODAY } from "./fixtures";
import {
  inMemoryAdvocates,
  inMemoryCases,
  inMemoryClients,
  inMemoryInvoices,
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
}

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
  const repositories = Layer.mergeAll(
    inMemoryCases(firm.matters ?? matters),
    inMemoryClients(clients),
    inMemoryAdvocates(advocates),
    inMemoryInvoices(firm.invoices ?? invoices),
  );

  const services = Layer.mergeAll(
    CaseService.Default,
    ClientService.Default,
    BillingService.Default,
  ).pipe(Layer.provide(repositories));

  const api = HttpApiBuilder.api(OkLawApi).pipe(
    Layer.provide([CasesHandlers, ClientsHandlers, BillingHandlers]),
    Layer.provide(services),
  );

  const { handler, dispose } = HttpApiBuilder.toWebHandler(
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
  const fetchHandler: typeof fetch = (input, init) =>
    handler(new Request(input as RequestInfo, init));

  const client: Effect.Effect<OkLawClient> = makeClient(BASE_URL).pipe(
    Effect.provide(
      FetchHttpClient.layer.pipe(
        Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchHandler)),
      ),
    ),
  );

  return { client, handler, dispose };
};

/** Runs a test body against a freshly built API, then closes it. */
export const withApi = <A, E>(
  body: (client: OkLawClient) => Effect.Effect<A, E>,
  firm?: Firm,
): Effect.Effect<A, E> =>
  Effect.gen(function* () {
    const api = runningApi(firm);
    return yield* Effect.acquireUseRelease(api.client, body, () =>
      Effect.promise(() => api.dispose()),
    );
  });
