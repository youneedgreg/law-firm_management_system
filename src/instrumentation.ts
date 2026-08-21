import { registerOTel } from "@vercel/otel";
import { Effect } from "effect";
import type { Instrumentation } from "next";
import { ServiceIdentity } from "./infra/config";
import { LoggingLive } from "./infra/telemetry/logging";

/**
 * The first thing this process does.
 *
 * Next calls `register` once per server instance, before the first request is
 * served, in both the Node and Edge runtimes. It is the only hook that runs
 * early enough to install a tracer provider that Next's *own* spans will be
 * written to — which is the point. Registering OpenTelemetry from inside a
 * Layer would be too late: by the time `AppLayer` is built, the request span
 * has already been opened and dropped on the floor.
 *
 * ## Why `@vercel/otel` rather than the SDK directly
 *
 * `NodeSDK` from `@opentelemetry/sdk-node` is the manual equivalent and does
 * not run in the Edge runtime, which `proxy.ts` uses. More usefully,
 * `registerOTel` picks the export mechanism from the environment rather than
 * from code: a tracing integration configured on the Vercel project is used
 * automatically, and failing that, the standard `OTEL_EXPORTER_OTLP_ENDPOINT`
 * and `OTEL_EXPORTER_OTLP_HEADERS` variables are honoured. Pointing this
 * application at Grafana Cloud, Honeycomb, Dash0 or a collector on a laptop is
 * therefore two environment variables and no deployment — and, importantly, no
 * vendor's name compiled into the source.
 *
 * When neither is configured, spans are created and discarded. That is the
 * intended state locally, and it is why there is no flag to turn tracing off.
 *
 * ## Where the spans come from
 *
 * Three sources, in one trace:
 *
 * - **Next**, for free: the request, the route render, every `fetch`.
 * - **Effect**, through `infra/telemetry/tracing.ts`, which builds its tracer
 *   from the provider registered here. Boundary spans in `runtime/`, and one
 *   per statement from `@effect/sql`.
 * - **Anything else** that reads the global provider, which is what makes this
 *   the right place for it rather than a corner of the application's own wiring.
 */
export function register(): void {
  const identity = Effect.runSync(
    ServiceIdentity.pipe(Effect.provide(ServiceIdentity.Default)),
  );

  registerOTel({
    serviceName: identity.name,
    attributes: { "service.version": identity.version },
  });
}

/**
 * The other half of the failure story, and the half that used to be missing.
 *
 * `attempt` and `attemptAs` report the failures they *swallow* — the ones that
 * become a sentence beside a form and are then gone. This hook catches the
 * opposite case: a failure that was allowed to propagate. A `RepositoryFailure`
 * out of a Server Component, a defect from anywhere, a render that threw. Next
 * catches it, replaces it with a digest, and shows the nearest `error.tsx`.
 *
 * Without this hook the digest is all anybody gets, on both sides. The screen
 * says "reference 3f9a2c" and the log says nothing, so the reference points at
 * an entry that was never written. This is the entry.
 *
 * ## Why the digest is the thing to log
 *
 * The trace id is not available here — by the time Next reports the error the
 * request's span is finished, so there is nothing for the logger to read. The
 * digest is the identifier that *does* survive: it is on the screen the person
 * is looking at, and it is stable for the same error, which is what makes "read
 * me the reference" a support conversation that terminates.
 *
 * The route context is worth as much. `routeType` says whether this was a
 * render, a route handler, a Server Action or the proxy — four very different
 * things, all of which otherwise arrive as "an error on /cases".
 *
 * ## Why not an error-tracking SDK
 *
 * See ADR 0011 and D-10: an exception already reaches the traces backend
 * through the span it failed, and this line reaches the log drain with the
 * digest and the route. A second vendor SDK would add a build-time wrapper, a
 * client bundle and a DSN, to send a third copy of the same event somewhere
 * else. When one of those is the alerting surface the firm actually watches,
 * this is the hook that feeds it.
 */
export const onRequestError: Instrumentation.onRequestError = (
  error,
  request,
  context,
) =>
  Effect.runPromise(
    Effect.logError("Unhandled failure while serving a request").pipe(
      Effect.annotateLogs({
        /**
         * `digest` is what the error boundary puts on the screen. Read through
         * a guard because the caught value is `unknown` — React replaces the
         * original error on the way out of a Server Component render, and what
         * arrives here is not always an `Error`.
         */
        digest:
          typeof error === "object" && error !== null && "digest" in error
            ? String((error as { digest: unknown }).digest)
            : undefined,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        method: request.method,
        path: request.path,
        route: context.routePath,
        routeType: context.routeType,
      }),
      Effect.provide(LoggingLive),
      /**
       * A logger that cannot be built because `LOG_LEVEL` is a typo must not
       * turn a reported error into a second, unreported one. The configuration
       * failure has already taken the process down elsewhere; here the job is
       * to get the line out.
       */
      Effect.catchAll(() => Effect.logError("Unhandled failure", error)),
    ),
  );
