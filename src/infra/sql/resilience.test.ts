import { SqlError } from "@effect/sql";
import { describe, expect, it } from "@effect/vitest";
import {
  Cause,
  Duration,
  Effect,
  Exit,
  Fiber,
  Option,
  Schema,
  TestClock,
} from "effect";
import { contended, reading, writing } from "./resilience";

/**
 * Retry and timeout, proven without a clock.
 *
 * This is the file the phase's "Demonstrates" line is about. A retry policy is
 * ordinarily among the least testable things in a codebase: the behaviour worth
 * asserting is *what happens after eight hundred milliseconds of backoff*, and
 * the usual way to find out is `await sleep(1000)` — which makes the suite
 * slower, makes it flaky on a loaded CI runner, and still only tests the
 * timings somebody happened to hard-code.
 *
 * `TestClock` removes the clock from the equation. Time only passes when a test
 * says so, so "five seconds elapse" is an instruction rather than a wait, and
 * the whole file runs in single-digit milliseconds. Nothing here sleeps.
 *
 * What is asserted is deliberately not the exact delays. The schedule is
 * jittered — see `resilience.ts` for why that matters more than it sounds — so
 * each delay is a range, and a test asserting `50ms` would be asserting the
 * absence of the property the jitter is there to provide. The assertions are
 * therefore bounds on either side of each range, which is the strongest claim
 * that is actually true.
 */

/**
 * A driver error carrying a SQLSTATE, shaped the way `pg` shapes one.
 *
 * `depth` reproduces the nesting `sql.withTransaction` adds: the wrapper
 * catches the inner failure and raises its own `SqlError`, putting the driver's
 * code one level further down. It is a parameter because the classification has
 * to survive that, and because it did not once — see `failure.ts`.
 */
const refusedWith = (code: string, depth = 1): SqlError.SqlError => {
  let cause: unknown = { code };
  for (let level = 1; level < depth; level++) cause = { cause };
  return new SqlError.SqlError({ message: `SQLSTATE ${code}`, cause });
};

/** Counts its calls, so the assertions can be about attempts rather than time. */
const failingWith = (error: SqlError.SqlError) => {
  const state = { attempts: 0 };
  const query = Effect.suspend(() => {
    state.attempts += 1;
    return Effect.fail<SqlError.SqlError>(error);
  });
  return { state, query };
};

/** Long enough to exhaust every backoff this module can produce. */
const LONG_ENOUGH = Duration.seconds(30);

describe("what is retried, and what is replayed", () => {
  /**
   * Neon refusing connections while its compute wakes. The whole reason this
   * module exists: without a retry, the first page load after lunch is an error
   * screen for a database that is perfectly healthy.
   */
  it.effect("retries a read whose connection was refused", () =>
    Effect.gen(function* () {
      const { state, query } = failingWith(refusedWith("ECONNREFUSED"));

      const running = yield* Effect.fork(reading("CaseRepository.all")(query));
      yield* TestClock.adjust(LONG_ENOUGH);
      yield* Fiber.await(running);

      expect(state.attempts).toBe(3);
    }),
  );

  /**
   * The asymmetry the module is built around. A refused connection means the
   * statement was never sent, so replaying an `INSERT` is running it once.
   */
  it.effect("retries a write whose connection was refused", () =>
    Effect.gen(function* () {
      const { state, query } = failingWith(refusedWith("ECONNREFUSED"));

      const running = yield* Effect.fork(
        writing("InvoiceRepository.recordPayment")(query),
      );
      yield* TestClock.adjust(LONG_ENOUGH);
      yield* Fiber.await(running);

      expect(state.attempts).toBe(3);
    }),
  );

  /**
   * **The most important assertion in the file.** `ECONNRESET` is a connection
   * that dropped with a statement in flight: the payment may have committed and
   * the acknowledgement been lost, and there is no way to tell from here.
   *
   * A retry policy that treats every connection error alike posts the client's
   * M-Pesa confirmation to their ledger twice, and the firm finds out at
   * reconciliation rather than here.
   */
  it.effect("does not replay a write whose outcome is unknown", () =>
    Effect.gen(function* () {
      const { state, query } = failingWith(refusedWith("ECONNRESET"));

      const running = yield* Effect.fork(
        writing("InvoiceRepository.recordPayment")(query),
      );
      yield* TestClock.adjust(LONG_ENOUGH);
      yield* Fiber.await(running);

      expect(state.attempts).toBe(1);
    }),
  );

  /** The same error, on a read, where a replay costs a round trip and nothing. */
  it.effect("does replay a read whose outcome is unknown", () =>
    Effect.gen(function* () {
      const { state, query } = failingWith(refusedWith("ECONNRESET"));

      const running = yield* Effect.fork(reading("CaseRepository.all")(query));
      yield* TestClock.adjust(LONG_ENOUGH);
      yield* Fiber.await(running);

      expect(state.attempts).toBe(3);
    }),
  );

  /**
   * A deadlock is safe to replay on anything, because Postgres has already
   * discarded the work and said so. This is the one class where retrying a
   * write is not a judgement call.
   */
  it.effect("replays a write Postgres rolled back itself", () =>
    Effect.gen(function* () {
      const { state, query } = failingWith(refusedWith("40P01"));

      const running = yield* Effect.fork(
        writing("TrustRepository.recordWithdrawal")(query),
      );
      yield* TestClock.adjust(LONG_ENOUGH);
      yield* Fiber.await(running);

      expect(state.attempts).toBe(3);
    }),
  );

  /**
   * The nesting a transaction adds. This is the shape that broke the unique
   * violation translation once already, and the classification has to see
   * through it for exactly the same reason.
   */
  it.effect("finds the code underneath a transaction wrapper", () =>
    Effect.gen(function* () {
      const { state, query } = failingWith(refusedWith("40001", 3));

      const running = yield* Effect.fork(
        writing("InvoiceRepository.save")(query),
      );
      yield* TestClock.adjust(LONG_ENOUGH);
      yield* Fiber.await(running);

      expect(state.attempts).toBe(3);
    }),
  );

  /**
   * The database answered, correctly, and will answer the same way again.
   * Retrying a constraint violation turns one clear refusal into three slow
   * ones and changes nothing else.
   */
  it.effect("does not retry a refusal the database meant", () =>
    Effect.gen(function* () {
      const { state, query } = failingWith(refusedWith("23505"));

      const running = yield* Effect.fork(reading("CaseRepository.all")(query));
      yield* TestClock.adjust(LONG_ENOUGH);
      yield* Fiber.await(running);

      expect(state.attempts).toBe(1);
    }),
  );

  /**
   * A `ParseError` is the query succeeding and the rows not satisfying the
   * domain — stored data the model says cannot exist. It does not become valid
   * on a second reading.
   */
  it.effect("does not retry stored data the domain refuses", () =>
    Effect.gen(function* () {
      const state = { attempts: 0 };
      const query = Effect.suspend(() => {
        state.attempts += 1;
        return Schema.decodeUnknown(Schema.Number)("not a number");
      });

      const running = yield* Effect.fork(reading("CaseRepository.byId")(query));
      yield* TestClock.adjust(LONG_ENOUGH);
      yield* Fiber.await(running);

      expect(state.attempts).toBe(1);
    }),
  );
});

describe("the shape of the backoff", () => {
  /**
   * Three assertions in one, and the bounds are chosen around the jitter rather
   * than around the nominal delays. Effect's `jittered` spreads each delay over
   * ±20%, so the first is somewhere in [40ms, 60ms] and the second in
   * [80ms, 120ms]; the checkpoints sit outside those ranges on both sides.
   *
   * Between them they pin down everything worth pinning: that the first retry
   * is *not* immediate, that it has happened by the time the first range
   * closes, and that the second wait is longer than the first — which is what
   * "exponential" means operationally.
   */
  it.effect("waits, then waits longer", () =>
    Effect.gen(function* () {
      const { state, query } = failingWith(refusedWith("ECONNREFUSED"));

      const running = yield* Effect.fork(reading("CaseRepository.all")(query));

      yield* TestClock.adjust(Duration.zero);
      expect(state.attempts).toBe(1);

      /** Before the earliest the first backoff can end. */
      yield* TestClock.adjust(Duration.millis(39));
      expect(state.attempts).toBe(1);

      /** After the latest it can end, and before the second can. */
      yield* TestClock.adjust(Duration.millis(22));
      expect(state.attempts).toBe(2);

      /** Past the second range, which is twice the first. */
      yield* TestClock.adjust(Duration.millis(130));
      expect(state.attempts).toBe(3);

      /** And then it stops, rather than retrying an outage indefinitely. */
      yield* TestClock.adjust(Duration.seconds(30));
      expect(state.attempts).toBe(3);

      const exit = yield* Fiber.await(running);
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );
});

describe("the budget on an attempt", () => {
  /**
   * The failure a timeout exists for is not a slow query, it is a socket that
   * accepts the request and never answers. There is no error to catch: without
   * a budget the request stays open until the platform kills the function, and
   * somebody watches a spinner for the whole of it.
   */
  it.effect("abandons a read that never answers, and tries again", () =>
    Effect.gen(function* () {
      const state = { attempts: 0 };
      const query = Effect.suspend(() => {
        state.attempts += 1;
        return Effect.never;
      });

      const running = yield* Effect.fork(reading("CaseRepository.all")(query));

      yield* TestClock.adjust(Duration.seconds(4));
      expect(state.attempts).toBe(1);

      /** Five seconds is the budget, so the second attempt starts here. */
      yield* TestClock.adjust(Duration.seconds(2));
      expect(state.attempts).toBe(2);

      yield* TestClock.adjust(Duration.seconds(30));
      const exit = yield* Fiber.await(running);

      expect(state.attempts).toBe(3);
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  /**
   * The same hang on a write, and the opposite behaviour. A statement that was
   * abandoned may still be running on the server; replaying it is the
   * double-posting case again, arriving through a clock instead of a socket.
   */
  it.effect("abandons a write that never answers, and does not try again", () =>
    Effect.gen(function* () {
      const state = { attempts: 0 };
      const query = Effect.suspend(() => {
        state.attempts += 1;
        return Effect.never;
      });

      const running = yield* Effect.fork(
        writing("InvoiceRepository.recordPayment")(query),
      );

      yield* TestClock.adjust(Duration.seconds(30));
      const exit = yield* Fiber.await(running);

      expect(state.attempts).toBe(1);
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  /** The caller is told what happened, in the words it already understands. */
  it.effect("reports the abandoned attempt as the repository failing", () =>
    Effect.gen(function* () {
      const running = yield* Effect.fork(
        writing("InvoiceRepository.recordPayment")(Effect.never),
      );

      yield* TestClock.adjust(Duration.seconds(30));
      const exit = yield* Fiber.await(running);

      const failure = Exit.isFailure(exit)
        ? Option.getOrUndefined(Cause.failureOption(exit.cause))
        : undefined;

      expect(failure?._tag).toBe("RepositoryFailure");
      expect(failure?.operation).toBe("InvoiceRepository.recordPayment");
      expect(failure?.detail).toBe("no answer within 5s");
    }),
  );
});

describe("a transaction that lost a race", () => {
  /**
   * The failure the statement-level retries cannot reach. A deadlock aborts the
   * whole transaction, so retrying a statement inside it re-runs it in a
   * transaction that no longer exists; the `BEGIN` has to be retried too.
   */
  it.effect("is retried when Postgres rolled it back", () =>
    Effect.gen(function* () {
      const { state, query } = failingWith(refusedWith("40P01"));

      const running = yield* Effect.fork(contended(query));
      yield* TestClock.adjust(LONG_ENOUGH);
      yield* Fiber.await(running);

      expect(state.attempts).toBe(3);
    }),
  );

  /**
   * And nothing else is, which is the restriction that makes retrying a
   * money-moving transaction safe at all. A dropped connection may have
   * committed some of the work before the wrapper noticed.
   */
  it.effect("is not retried when the connection merely dropped", () =>
    Effect.gen(function* () {
      const { state, query } = failingWith(refusedWith("ECONNRESET"));

      const running = yield* Effect.fork(contended(query));
      yield* TestClock.adjust(LONG_ENOUGH);
      yield* Fiber.await(running);

      expect(state.attempts).toBe(1);
    }),
  );
});
