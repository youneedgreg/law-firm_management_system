import { Resource, Tracer } from "@effect/opentelemetry";
import { Effect, Layer } from "effect";
import { ServiceIdentity } from "../config";

/**
 * Effect's spans, expressed as OpenTelemetry spans.
 *
 * ## Why this is `layerGlobal` and not `NodeSdk.layer`
 *
 * `@effect/opentelemetry` will happily build a tracer provider of its own —
 * `NodeSdk.layer` does exactly that, and every example on the internet uses it.
 * Here it would be the wrong choice, and wrong in a way that is invisible until
 * you look at a trace and find two of them.
 *
 * Next.js is already instrumented. It opens a span for the incoming request,
 * one for rendering the route, one for each `fetch` — see `instrumentation.ts`,
 * where `registerOTel` installs the provider those spans are written to. A
 * second provider built inside `AppLayer` would export a second, parallel trace
 * containing only the Effect half: `CaseService.open` with no request above it,
 * and `GET /cases` with nothing underneath. Both are real, neither is useful,
 * and the question this phase exists to answer — *where did the two seconds
 * go* — is answerable from neither.
 *
 * `layerGlobal` reads the provider the platform already installed, so Effect's
 * spans are children of Next's. The nesting happens because
 * `@effect/opentelemetry` falls back to the *active* OpenTelemetry context when
 * a fiber has no Effect parent span — which is precisely the situation on the
 * first `yield*` inside a Server Component.
 *
 * ## When nothing is listening
 *
 * `trace.getTracerProvider()` answers with a no-op provider when nothing has
 * registered one — in a unit test, in the seed script, in `next build`. Spans
 * are then created and dropped, at the cost of an object allocation. That is
 * why this layer has no "enabled" flag: there is nothing to switch off, and a
 * flag would be a second way for tracing to be silently absent.
 */
export const TracingLive = Layer.unwrapEffect(
  Effect.gen(function* () {
    const identity = yield* ServiceIdentity;

    /**
     * The `Resource` here names the *instrumentation scope* — it becomes the
     * arguments to `provider.getTracer(name, version)`, so every span this
     * application opens is attributable to `oklaw` at a known commit, and is
     * distinguishable from the spans Next opens for itself.
     *
     * It is deliberately not where the resource attributes on an exported span
     * come from. Those belong to the provider, and `registerOTel` already sets
     * them from the platform: `deployment.environment.name`, `cloud.region`,
     * `vcs.ref.head.revision` and the rest. Restating them here would be a
     * second source for the same facts, and the second one is the one that goes
     * stale.
     */
    return Tracer.layerGlobal.pipe(
      Layer.provide(
        Resource.layer({
          serviceName: identity.name,
          serviceVersion: identity.version,
        }),
      ),
    );
  }),
).pipe(Layer.provide(ServiceIdentity.Default));
