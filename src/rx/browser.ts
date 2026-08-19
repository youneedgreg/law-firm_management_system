import { Rx } from "@effect-rx/rx-react";
import { FetchHttpClient } from "@effect/platform";
import { Context, Effect, Layer } from "effect";
import { makeClient, type OkLawClient } from "../api/client";
import { BrowserKeyValueStore } from "./storage";

/**
 * Where the layers meet the browser.
 *
 * `src/runtime/` is the same idea on the server: one place that knows both what
 * the application asks for and what supplies it. This is its counterpart, and
 * the two share no code because they share no implementations — the server
 * reaches Postgres through a connection pool, and the browser reaches the same
 * data through the API, over `fetch`, as any other consumer would.
 *
 * `Rx.runtime` turns a Layer into a runtime the atoms can be built from.
 * `browserRuntime.rx(effect)` produces an `Rx<Result<A, E>>` whose services are
 * provided from this Layer, built once, memoised for the life of the registry
 * and torn down with it. There is no provider component holding a client, no
 * `useEffect` constructing one per mount, and nothing to pass down the tree.
 */

/**
 * The API client, as a service.
 *
 * The value is the one `HttpApiClient` derives from the contract, so every call
 * an atom makes is the contract's own signature and every refusal arrives as
 * the class the service failed with. Holding it in a `Tag` rather than as a
 * module-level constant is what lets a test provide a different one — or, as
 * the component tests do, the same one over a different transport.
 */
export class Api extends Context.Tag("oklaw/browser/Api")<Api, OkLawClient>() {}

/**
 * The base URL the client prepends.
 *
 * `window.location.origin` in a browser, and an empty string anywhere else. The
 * empty string is not a fallback that might be used and be wrong: no atom
 * fetches during a server render, because every one that could declares a
 * server value instead (`Rx.withServerValueInitial`), and React reads *that*
 * rather than the atom on the server. This exists because the Layer is built
 * wherever the registry is, and building it must not depend on a `window` that
 * a server render does not have.
 */
const origin = (): string =>
  typeof window === "undefined" ? "" : window.location.origin;

const ApiLive = Layer.effect(
  Api,
  Effect.suspend(() => makeClient(origin())),
).pipe(Layer.provide(FetchHttpClient.layer));

/**
 * Everything an atom may ask for: the API, and somewhere to persist a choice.
 *
 * As deliberately short as the server's `AppLayer` and for the same reason — a
 * layer listed here that nothing uses is a claim the app does not honour.
 */
export const BrowserLayer = Layer.mergeAll(ApiLive, BrowserKeyValueStore);

export const browserRuntime = Rx.runtime(BrowserLayer);
