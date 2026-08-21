import { registerOTel } from "@vercel/otel";
import { Effect } from "effect";
import { ServiceIdentity } from "./infra/config";

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
