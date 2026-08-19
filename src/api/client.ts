import { FetchHttpClient, HttpApiClient } from "@effect/platform";
import { Effect } from "effect";
import { OkLawApi } from "./contract";

/**
 * The client, derived from the contract.
 *
 * There is no `fetch` call in this file, no URL built by hand, and no response
 * type written down. `HttpApiClient.make` reads the same `HttpApi` value the
 * server is built from and produces a method per endpoint, so
 * `client.cases.file({ path: { id } })` is checked against the definition: pass
 * a `ClientId` where a `CaseId` belongs and it does not compile, rename an
 * endpoint and every call site fails, add a field to a response and it is
 * simply there, typed.
 *
 * The half that surprises people is the return. `file` yields a `CaseFile`
 * whose `openedOn` is a `Date` and whose `court` is the tagged union — not the
 * JSON that arrived. And a refusal comes back as the *class* the service failed
 * with, so `catchTag("AdvocateMayNotFile", (e) => e.reason)` compiles on the
 * client and prints the sentence the Advocates Act check wrote on the server,
 * which was never transmitted. Both ends share the schema; only the encoded
 * form crosses.
 *
 * ## What this is for, and what it is not for
 *
 * Not for Server Components. A page that called its own HTTP API would
 * serialise a `Case` to JSON and parse it back inside a single process, to
 * reach a service it could have called directly — the runtime is right there.
 * Phase 3's pages call `run` and will keep doing so.
 *
 * It is for the browser (Phase 5 drives Rx atoms from these methods), for
 * anything outside this process, and — immediately — for the tests, which run
 * it against the real handler with no socket in between. That last use is the
 * one that makes the contract's claim checkable rather than asserted: if the
 * server and the client could drift, a test that speaks through both would be
 * where it showed.
 */

/**
 * A client bound to a base URL.
 *
 * `baseUrl` is required rather than defaulted to the current origin, because
 * there is no current origin in a test or on a server, and a default that only
 * works in a browser is a default that fails somewhere quiet.
 */
export const makeClient = (baseUrl: string) =>
  HttpApiClient.make(OkLawApi, { baseUrl });

/**
 * What `makeClient` yields — a method per endpoint, grouped as the API is.
 *
 * Written as the inferred type rather than an interface, so it is the contract
 * that defines it. An interface here would be a fourth description of the API
 * and the one nobody remembers to update.
 */
export type OkLawClient = Effect.Effect.Success<ReturnType<typeof makeClient>>;

/**
 * The client, over the platform's `fetch`.
 *
 * Kept separate from `makeClient` so a caller can supply a different
 * `HttpClient` — which is exactly what the tests do, handing it one backed by
 * the in-process handler instead of the network.
 */
export const fetchClient = (
  baseUrl: string,
): Effect.Effect<OkLawClient, never, never> =>
  makeClient(baseUrl).pipe(Effect.provide(FetchHttpClient.layer));
