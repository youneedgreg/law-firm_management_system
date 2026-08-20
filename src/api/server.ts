import { HttpApiBuilder, HttpApiScalar, HttpServer } from "@effect/platform";
import { Layer } from "effect";
import { AppLayer, runtime } from "../runtime";
import { OkLawApi } from "./contract";
import { AuthenticationLive } from "./handlers/authentication";
import { BillingHandlers } from "./handlers/billing";
import { CasesHandlers } from "./handlers/cases";
import { ClientsHandlers } from "./handlers/clients";
import { SessionHandlers } from "./handlers/session";
import { OpenApiRoute } from "./openapi";

/**
 * The API, assembled into something Next can mount.
 *
 * `toWebHandler` turns a Layer into a `(Request) => Promise<Response>`, which
 * is exactly the shape a Next route handler exports. No adapter, no server
 * process, no port: the same handler runs under `next dev`, on Vercel, and
 * inside a test that never opens a socket.
 *
 * ## One pool, not two
 *
 * The `memoMap` is the detail worth reading twice. `toWebHandler` builds the
 * Layer it is given, and `AppLayer` contains `PgLive` — so left alone it would
 * construct a *second* connection pool, alongside the one the `ManagedRuntime`
 * already built for Server Components. Two pools in one process, each sized for
 * the whole process, against a Neon instance with a connection limit.
 *
 * Passing the runtime's own memo map makes layer construction shared: `PgLive`
 * is built once, and whichever of the two asks for it second gets the pool the
 * first one made. The alternative — building the API over its own layers — is
 * the kind of thing that works locally, works in preview, and starts refusing
 * connections at exactly the traffic where you would rather it did not.
 */

const ApiLive = HttpApiBuilder.api(OkLawApi).pipe(
  Layer.provide([
    CasesHandlers,
    ClientsHandlers,
    BillingHandlers,
    SessionHandlers,
    /**
     * The middleware is a Layer like the handler groups, and is provided the
     * same way. It supplies `CurrentUser`, which every handler above requires —
     * so removing this line does not quietly open the API up, it stops the
     * whole thing compiling.
     */
    AuthenticationLive,
  ]),
  Layer.provide(AppLayer),
);

/**
 * Everything served under `/api`: the endpoints, the OpenAPI document, and the
 * documentation page that reads it.
 *
 * `HttpServer.layerContext` supplies the platform services the router needs
 * (`HttpPlatform`, `FileSystem`, `Path`, `Etag`) without starting a server —
 * there is no server to start, because Next is the server.
 */
const ServerLive = Layer.mergeAll(
  ApiLive,
  OpenApiRoute,
  HttpApiScalar.layerCdn({ path: "/api/docs", version: "1.34.6" }).pipe(
    Layer.provide(ApiLive),
  ),
  HttpServer.layerContext,
);

/**
 * Held on `globalThis` for the same reason the runtime is.
 *
 * Next re-evaluates modules on every edit in development, and a handler built
 * in a module-level `const` is rebuilt on each save. Since it shares the
 * runtime's memo map the pool survives, but the router and the OpenAPI document
 * would be rebuilt on every request-after-edit for no benefit. The symbol
 * outlives module reloads because `globalThis` does.
 */
const HANDLER = Symbol.for("oklaw.api.handler");

interface WebHandler {
  readonly handler: (request: Request) => Promise<Response>;
  readonly dispose: () => Promise<void>;
}

const holder = globalThis as unknown as { [HANDLER]?: WebHandler };

const build = (): WebHandler =>
  HttpApiBuilder.toWebHandler(ServerLive, { memoMap: runtime.memoMap });

const webHandler: WebHandler = (holder[HANDLER] ??= build());

/**
 * The API as a fetch handler.
 *
 * Typed as taking a bare `Request` rather than re-exporting `toWebHandler`'s
 * signature directly: its optional second parameter is an Effect `Context`, and
 * Next passes its own route context there. Narrowing the type here means the
 * two can never be confused for each other.
 */
export const handle = (request: Request): Promise<Response> =>
  webHandler.handler(request);

/** Closes the layers. Tests build their own handler and dispose of that. */
export const dispose = (): Promise<void> => webHandler.dispose();
