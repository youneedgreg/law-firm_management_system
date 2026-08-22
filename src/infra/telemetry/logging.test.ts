import { describe, expect, it } from "@effect/vitest";
import { Effect, Logger } from "effect";
import { clientWentAway, correlated } from "./logging";

/**
 * The claim under test is narrow and is the one the whole logging story rests
 * on: **a line logged anywhere inside a request carries the id of the trace
 * that request is, and a line logged outside one carries nothing.**
 *
 * It is worth a test rather than an eyeball because it fails silently. A logger
 * that quietly stopped finding the span would keep printing perfectly readable
 * lines; the loss would show up months later, at three in the morning, as the
 * absence of the field somebody was about to filter on.
 *
 * These run against Effect's own tracer rather than OpenTelemetry's. That is
 * deliberate — `Effect.withSpan` produces a span with a trace id either way, and
 * a test that needed a registered `TracerProvider` would be testing
 * `@vercel/otel` instead of this file.
 */

/**
 * A logger that keeps what it was given instead of printing it, wrapped in the
 * decorator under test.
 */
const collecting = () => {
  const lines: Array<{
    readonly message: unknown;
    readonly annotations: Record<string, unknown>;
  }> = [];

  const logger = correlated(
    Logger.map(Logger.structuredLogger, (record) => {
      lines.push({ message: record.message, annotations: record.annotations });
    }),
  );

  return {
    lines,
    layer: Logger.replace(Logger.defaultLogger, logger),
  };
};

describe("log correlation", () => {
  it.effect("stamps a line logged inside a span with that span's ids", () => {
    const collected = collecting();

    return Effect.gen(function* () {
      yield* Effect.log("reading the matter").pipe(Effect.withSpan("read"));

      const [line] = collected.lines;
      expect(line).toBeDefined();
      expect(line?.annotations.traceId).toEqual(expect.any(String));
      expect(line?.annotations.spanId).toEqual(expect.any(String));
    }).pipe(Effect.provide(collected.layer));
  });

  /**
   * The property that makes the id worth having. Two lines written from
   * different depths of the same request must join to each other; if they did
   * not, the field would be a span id under another name and would tell you
   * nothing you could not read off a single line.
   */
  it.effect("gives every line in one request the same trace id", () => {
    const collected = collecting();

    return Effect.gen(function* () {
      yield* Effect.gen(function* () {
        yield* Effect.log("at the boundary");
        yield* Effect.log("four layers down").pipe(
          Effect.withSpan("CaseRepository.byId"),
        );
      }).pipe(Effect.withSpan("GET /cases/:id"));

      const [outer, inner] = collected.lines;
      expect(outer?.annotations.traceId).toBe(inner?.annotations.traceId);
      expect(outer?.annotations.spanId).not.toBe(inner?.annotations.spanId);
    }).pipe(Effect.provide(collected.layer));
  });

  /**
   * A fiber forked mid-request is exactly where a hand-threaded request id gets
   * lost, because nobody passes the parameter into the fork. Effect carries the
   * span across the fork, so the id survives without anybody arranging it.
   */
  it.effect("survives a fork", () => {
    const collected = collecting();

    return Effect.gen(function* () {
      yield* Effect.gen(function* () {
        yield* Effect.log("on the request fiber");
        yield* Effect.forkScoped(Effect.log("on a forked fiber"));
        yield* Effect.yieldNow();
      }).pipe(Effect.withSpan("GET /dashboard"), Effect.scoped);

      const [onRequest, onFork] = collected.lines;
      expect(onFork).toBeDefined();
      expect(onFork?.annotations.traceId).toBe(onRequest?.annotations.traceId);
    }).pipe(Effect.provide(collected.layer));
  });

  /**
   * The seed script and the migration runner log outside any request. Inventing
   * an id for them would produce a field that joins to nothing, which reads as a
   * trace that was dropped rather than as one that never existed.
   */
  it.effect("adds nothing to a line logged outside a span", () => {
    const collected = collecting();

    return Effect.gen(function* () {
      yield* Effect.logInfo("Applying migrations…");

      const [line] = collected.lines;
      expect(line?.annotations).toEqual({});
    }).pipe(Effect.provide(collected.layer));
  });

  /** Annotations the caller set are kept; the ids are added beside them. */
  it.effect("does not displace the caller's own annotations", () => {
    const collected = collecting();

    return Effect.gen(function* () {
      yield* Effect.logError("Repository call failed").pipe(
        Effect.annotateLogs({ operation: "byId" }),
        Effect.withSpan("CaseRepository.byId"),
      );

      const [line] = collected.lines;
      expect(line?.annotations.operation).toBe("byId");
      expect(line?.annotations.traceId).toEqual(expect.any(String));
    }).pipe(Effect.provide(collected.layer));
  });
});

/**
 * The second claim, and the one an end-to-end run found rather than a person.
 *
 * Next prefetches the next route as a stream and cancels it the moment
 * somebody navigates, so `onRequestError` sees an abandoned write constantly
 * during ordinary use. Reported at `Error` it is a steady drip of noise into
 * the one view that exists to hold real faults — and the failure mode of noise
 * is not that it is annoying, it is that it teaches people to skim.
 */
describe("telling a client's departure from a fault", () => {
  it.each([
    ["The destination stream closed early.", "the RSC prefetch Next cancels"],
    ["read ECONNRESET", "a connection dropped under us"],
    ["The operation was aborted", "an explicit abort"],
  ])("treats %j as the client going away — %s", (message) => {
    expect(clientWentAway(new Error(message))).toBe(true);
  });

  it("names an AbortError however it is worded", () => {
    const aborted = new Error("something else entirely");
    aborted.name = "AbortError";

    expect(clientWentAway(aborted)).toBe(true);
  });

  it.each([
    ["PgClient: Connection timed out"],
    ["Advocates (Accounts) Rules r.10: cannot withdraw"],
    ["Cannot read properties of undefined"],
  ])("leaves a real failure alone: %j", (message) => {
    // The bar this has to clear: a database that stopped answering must not be
    // quietly demoted because its message happens to mention a connection.
    expect(clientWentAway(new Error(message))).toBe(false);
  });

  it("does not guess about a value that is not an Error", () => {
    // React replaces the error on the way out of a Server Component render, so
    // what arrives is not always an `Error` — and a string nobody can inspect
    // is a fault until proven otherwise.
    expect(clientWentAway("closed early")).toBe(false);
    expect(clientWentAway(undefined)).toBe(false);
  });
});
