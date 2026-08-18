import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Either, Fiber, Schema, TestClock } from "effect";

/**
 * Phase 0 smoke test: proves the toolchain works before any real code depends
 * on it. If this file fails, nothing else in the test suite can be trusted.
 *
 * It deliberately covers the three things the roadmap leans on hardest:
 * running Effects in tests, virtual time, and schema decoding.
 */
describe("test harness", () => {
  it.effect("runs an Effect and surfaces its success value", () =>
    Effect.gen(function* () {
      const answer = yield* Effect.succeed(42);
      expect(answer).toBe(42);
    }),
  );

  it.effect("types errors as values rather than throwing", () =>
    Effect.gen(function* () {
      const result = yield* Effect.either(Effect.fail("expected failure"));
      expect(Either.isLeft(result)).toBe(true);
    }),
  );

  it.effect("collapses a one-hour sleep to nothing under TestClock", () =>
    Effect.gen(function* () {
      // The capability the roadmap's Phase 8 retry/timeout tests depend on:
      // real elapsed time is zero, so the suite stays fast and deterministic.
      const fiber = yield* Effect.fork(
        Effect.sleep(Duration.hours(1)).pipe(Effect.as("woke up")),
      );

      yield* TestClock.adjust(Duration.hours(1));

      expect(yield* Fiber.join(fiber)).toBe("woke up");
    }),
  );
});

describe("effect/Schema", () => {
  // Note the import path: Schema comes from `effect` core, not the deprecated
  // `@effect/schema` package. See ADR 0002.
  const Advocate = Schema.Struct({
    name: Schema.String,
    admittedYear: Schema.Number.pipe(Schema.int(), Schema.greaterThan(1900)),
  });

  it("decodes valid input", () => {
    const decoded = Schema.decodeUnknownSync(Advocate)({
      name: "A. Mwangi",
      admittedYear: 2014,
    });

    expect(decoded).toStrictEqual({ name: "A. Mwangi", admittedYear: 2014 });
  });

  it("rejects input violating a refinement", () => {
    const result = Schema.decodeUnknownEither(Advocate)({
      name: "A. Mwangi",
      admittedYear: 1066,
    });

    expect(Either.isLeft(result)).toBe(true);
  });
});
