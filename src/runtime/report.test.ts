import { describe, expect, it } from "@effect/vitest";
import { Effect, Either, Logger, LogLevel } from "effect";
import { MatterIsClosed } from "../domain/case/case";
import { NotPermitted } from "../domain/identity/permissions";
import { RepositoryFailure, StorageFailure } from "../services/repositories";
import { reported } from "./report";

/**
 * What is being tested is a judgement, not a mechanism: **which failures are
 * worth waking somebody for, and which are the product working.**
 *
 * Both mistakes are expensive and neither announces itself. Log every refusal
 * at `Error` and the two categories that matter drown in a firm being told no
 * forty times a day; log none of them and a `StorageFailure` that stopped every
 * upload is a support ticket rather than an alert. So the levels are asserted
 * by name.
 */

const captured = () => {
  const lines: Array<{
    readonly level: string;
    readonly annotations: Record<string, unknown>;
  }> = [];

  return {
    lines,
    layer: Logger.replace(
      Logger.defaultLogger,
      Logger.map(Logger.structuredLogger, (record) => {
        lines.push({ level: record.logLevel, annotations: record.annotations });
      }),
    ),
  };
};

/** `Debug` is below the default, and two of the three cases are `Debug`. */
const observing = <A, E>(effect: Effect.Effect<A, E>) => {
  const log = captured();

  return Effect.either(reported(effect)).pipe(
    Effect.map((outcome) => ({ outcome, lines: log.lines })),
    Effect.provide(log.layer),
    Logger.withMinimumLogLevel(LogLevel.All),
  );
};

describe("reporting a typed failure", () => {
  it.effect("calls a database that will not answer an error", () =>
    Effect.gen(function* () {
      const { lines } = yield* observing(
        Effect.fail(
          new RepositoryFailure({ operation: "byId", detail: "timeout" }),
        ),
      );

      expect(lines[0]?.level).toBe("ERROR");
      expect(lines[0]?.annotations.failure).toBe("RepositoryFailure");
      expect(lines[0]?.annotations.reason).toBe("byId failed: timeout");
    }),
  );

  it.effect("calls a blob store that will not sign one too", () =>
    Effect.gen(function* () {
      const { lines } = yield* observing(
        Effect.fail(
          new StorageFailure({ operation: "signedUrl", detail: "403" }),
        ),
      );

      expect(lines[0]?.level).toBe("ERROR");
      expect(lines[0]?.annotations.failure).toBe("StorageFailure");
    }),
  );

  /**
   * Not an outage, and not nothing. A role reaching an operation it does not
   * hold is either a screen offering a button it should not — a bug — or
   * somebody trying doors. Both are worth a warning and neither is a page.
   */
  it.effect("warns when a caller is refused something they may not have", () =>
    Effect.gen(function* () {
      const { lines } = yield* observing(
        Effect.fail(
          new NotPermitted({ role: "Receptionist", permission: "case:open" }),
        ),
      );

      expect(lines[0]?.level).toBe("WARN");
      expect(lines[0]?.annotations.reason).toBe(
        "A Receptionist may not case open",
      );
    }),
  );

  /**
   * The category that would otherwise swamp the other two. A closed matter
   * being refused an amendment is the system doing its job, told to somebody
   * who will read the sentence on the form and move on.
   */
  it.effect("logs an ordinary refusal at debug", () =>
    Effect.gen(function* () {
      const { lines } = yield* observing(
        Effect.fail(
          new MatterIsClosed({
            number: "OKL-2026-014",
            attempted: "amend",
          }),
        ),
      );

      expect(lines[0]?.level).toBe("DEBUG");
      expect(lines[0]?.annotations.failure).toBe("MatterIsClosed");
    }),
  );

  /**
   * The property that lets this sit at the boundary rather than at each call
   * site: reporting is a tap, so the failure the action receives is the same
   * value it would have received without it.
   */
  it.effect("hands the failure on unchanged", () =>
    Effect.gen(function* () {
      const failure = new MatterIsClosed({
        number: "OKL-2026-014",
        attempted: "amend",
      });
      const { outcome } = yield* observing(Effect.fail(failure));

      expect(Either.isLeft(outcome)).toBe(true);
      if (Either.isLeft(outcome)) expect(outcome.left).toBe(failure);
    }),
  );

  it.effect("says nothing at all about a success", () =>
    Effect.gen(function* () {
      const { lines } = yield* observing(Effect.succeed("filed"));

      expect(lines).toHaveLength(0);
    }),
  );

  /**
   * `reported` sits on the generic `E` of an arbitrary effect, so it has to
   * survive a failure that is not one of this codebase's tagged errors —
   * anything thrown by a dependency and lifted into the failure channel. A
   * boundary helper that threw while reporting a failure would replace a
   * legible error with an illegible one.
   */
  it.effect("survives a failure that is not a tagged error", () =>
    Effect.gen(function* () {
      const { lines } = yield* observing(Effect.fail("something went wrong"));

      expect(lines[0]?.level).toBe("DEBUG");
      expect(lines[0]?.annotations.failure).toBe("Unknown");
      expect(lines[0]?.annotations.reason).toBe("something went wrong");
    }),
  );
});
