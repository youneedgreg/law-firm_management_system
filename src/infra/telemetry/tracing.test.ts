import { trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { describe, expect, it } from "@effect/vitest";
import { ConfigProvider, Effect } from "effect";
import { TracingLive } from "./tracing";

/**
 * The claim: **an Effect span is written to the provider the platform
 * registered, not to one of this application's own.**
 *
 * It is worth proving rather than assuming, because the failure is not an
 * error. A second provider built inside `AppLayer` would produce spans that
 * look perfectly correct in isolation and export to nowhere — or worse, to a
 * second trace alongside Next's, with the request in one and the query in the
 * other. Nothing throws; you simply cannot answer the question the trace was
 * collected to answer.
 *
 * So the test stands in for `registerOTel`: it registers a provider globally,
 * exactly as `instrumentation.ts` does, and then asserts that spans opened
 * through Effect arrive in *that* provider's exporter.
 */

const exported = () => {
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  provider.register();

  return {
    exporter,
    /** Registering mutates process-global state; every test undoes its own. */
    reset: () => {
      trace.disable();
      return provider.shutdown();
    },
  };
};

const traced = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(TracingLive),
      Effect.withConfigProvider(
        ConfigProvider.fromMap(
          new Map([
            ["VERCEL_GIT_COMMIT_SHA", "9f2c1ab4e7d3115a0c8ee0aa3c1d9e2f"],
            ["VERCEL_ENV", "production"],
          ]),
        ),
      ),
    ),
  );

describe("tracing", () => {
  it("writes Effect spans to the globally registered provider", async () => {
    const otel = exported();

    try {
      await traced(Effect.void.pipe(Effect.withSpan("CaseService.open")));

      const [span] = otel.exporter.getFinishedSpans();
      expect(span?.name).toBe("CaseService.open");
    } finally {
      await otel.reset();
    }
  });

  /**
   * The instrumentation scope is what separates this application's spans from
   * the ones Next opens for itself, and the version is what says which build
   * produced them. Both come from `ServiceIdentity`, so a trace read six weeks
   * later can still be pinned to a commit.
   */
  it("attributes them to this application, at this commit", async () => {
    const otel = exported();

    try {
      await traced(Effect.void.pipe(Effect.withSpan("CaseRepository.byId")));

      const [span] = otel.exporter.getFinishedSpans();
      expect(span?.instrumentationScope.name).toBe("oklaw");
      expect(span?.instrumentationScope.version).toBe("9f2c1ab");
    } finally {
      await otel.reset();
    }
  });

  /**
   * Nesting is the whole point. `GET /cases` from Next, `CaseService.list`
   * under it, `CaseRepository.all` under that — one trace, read top to bottom,
   * which is what "trace a slow request end to end" means in practice.
   */
  it("nests a span inside the one already open", async () => {
    const otel = exported();

    try {
      await traced(
        Effect.void.pipe(
          Effect.withSpan("CaseRepository.all"),
          Effect.withSpan("CaseService.list"),
        ),
      );

      const spans = otel.exporter.getFinishedSpans();
      const inner = spans.find((span) => span.name === "CaseRepository.all");
      const outer = spans.find((span) => span.name === "CaseService.list");

      expect(inner?.parentSpanContext?.spanId).toBe(
        outer?.spanContext().spanId,
      );
      expect(inner?.spanContext().traceId).toBe(outer?.spanContext().traceId);
    } finally {
      await otel.reset();
    }
  });

  /**
   * The state every local run and every unit test is in. `trace.getTracer` on
   * an unregistered API answers with a no-op, so spans are created and dropped
   * — which is why tracing needs no on/off switch, and why forgetting to
   * configure an exporter costs an allocation rather than an outage.
   */
  it("is a no-op when nothing has registered a provider", async () => {
    trace.disable();

    const outcome = await traced(
      Effect.succeed("still runs").pipe(Effect.withSpan("CaseService.open")),
    );

    expect(outcome).toBe("still runs");
  });
});
