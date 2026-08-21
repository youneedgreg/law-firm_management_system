import { SqlError } from "@effect/sql";
import { Duration, Effect, Schedule } from "effect";
import type { RepositoryFailure } from "../../services/repositories";
import { codesIn, failure, type QueryFailure } from "./failure";

/**
 * What every repository operation is wrapped in, and the one question it turns
 * on: **if this statement is run twice, what happens?**
 *
 * Neon is serverless Postgres behind a proxy. It scales its compute to zero
 * after five minutes idle, closes idle connections routinely, and hands out
 * connection failures while it is waking up. None of that is a fault; it is the
 * product working as sold. But it means the first page load after lunch can
 * meet `ECONNREFUSED` on a database that is perfectly healthy, and without a
 * retry that is an error screen for a condition that resolves in 300ms.
 *
 * So: retry. The whole difficulty is that "retry on transient errors" is
 * dangerously close to "post the payment twice".
 *
 * ## Three classes, not one
 *
 * A retry is only safe when you can say what the *previous* attempt did. There
 * are exactly three answers, and the codes divide cleanly between them.
 *
 * - **It never ran.** The connection was refused, or the pool was full, or the
 *   server was not accepting connections yet. The statement was never sent, so
 *   nothing happened, so running it again is running it once. Safe for
 *   anything, including an `INSERT` that moves client money.
 *
 * - **Postgres rolled it back.** A serialization failure or a deadlock; the
 *   server aborted the transaction and said so. Safe by definition — retrying
 *   is what these codes are *for*, and a system that does not retry them is one
 *   that surfaces `40P01` to an advocate.
 *
 * - **Nobody knows.** The connection dropped mid-statement, or the attempt
 *   timed out. The write may have committed and the acknowledgement been lost;
 *   there is no way to tell from here. **Reads are retried, writes are not.**
 *   Replaying a `SELECT` costs a round trip. Replaying `recordPayment` posts a
 *   client's M-Pesa confirmation to their ledger twice, and the firm finds out
 *   at reconciliation.
 *
 * That last distinction is the reason this module exists rather than one
 * `Effect.retry` in `client.ts`. A single policy has to pick one of those two
 * behaviours for everything, and both choices are wrong somewhere.
 *
 * ## What is never retried
 *
 * A `ParseError` — the query succeeded and the rows do not satisfy the domain.
 * Stored data does not become valid on a second reading, and a retry here would
 * turn one clear failure into three slow ones. It falls through the predicate
 * because it carries no `code`, which is worth stating out loud rather than
 * relying on.
 *
 * Nor is a constraint violation, a syntax error, or a permission refusal. Same
 * reason: the database's answer was correct and will be correct again.
 */

/**
 * The statement provably never reached the server, so replaying it is running
 * it for the first time.
 */
const NEVER_RAN: ReadonlySet<string> = new Set([
  /** `sqlclient_unable_to_establish_sqlconnection` */
  "08001",
  /** `sqlserver_rejected_establishment_of_sqlconnection` */
  "08004",
  /** `cannot_connect_now` — Postgres is starting up. Neon, waking. */
  "57P03",
  /** `too_many_connections` */
  "53300",
  /** `configuration_limit_exceeded` */
  "53400",
  /** Nothing listening on the socket yet. */
  "ECONNREFUSED",
]);

/**
 * Postgres aborted the transaction itself and expects the client to try again.
 * The rollback is the server's, so there is nothing half-done to worry about.
 */
const ROLLED_BACK: ReadonlySet<string> = new Set([
  /** `serialization_failure` */
  "40001",
  /** `deadlock_detected` */
  "40P01",
]);

/**
 * The connection went away with a statement in flight. Whether it committed is
 * not knowable from this side — which is exactly why `08007`
 * (`transaction_resolution_unknown`) is in this set and not in `NEVER_RAN`,
 * despite sharing the `08` class with codes that are safe. The class is not the
 * criterion; what the attempt might have done is.
 */
const OUTCOME_UNKNOWN: ReadonlySet<string> = new Set([
  /** `connection_exception` */
  "08000",
  /** `connection_does_not_exist` */
  "08003",
  /** `connection_failure` */
  "08006",
  /** `transaction_resolution_unknown` */
  "08007",
  /** `admin_shutdown` — Neon closing an idle connection. */
  "57P01",
  /** `crash_shutdown` */
  "57P02",
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  /** A DNS lookup that failed temporarily. */
  "EAI_AGAIN",
]);

/**
 * How long one attempt is given before it is abandoned.
 *
 * Five seconds is chosen against Neon's cold start rather than against a warm
 * query: a warm read answers in single-digit milliseconds, and the case this
 * budget exists for is the compute waking up, which takes a few hundred
 * milliseconds and occasionally longer. Anything under about two seconds would
 * turn a cold start into a failure, which is the opposite of the point.
 *
 * There is a budget at all because a query with none is not slow, it is
 * *indefinite*: a socket that has stopped answering without closing holds the
 * request open until the platform kills the function, and the user watches a
 * spinner for the whole of it. A failure at five seconds can be retried; a hang
 * cannot.
 */
const ATTEMPT = Duration.seconds(5);

/**
 * Two retries, so three attempts, with exponential backoff from 50ms.
 *
 * Jittered, and that is not a detail. Neon waking up refuses *every* connection
 * for the same few hundred milliseconds, so without jitter every in-flight
 * request retries in lockstep and arrives together — a thundering herd against
 * a database that has just come up, self-inflicted by the mechanism meant to
 * protect it.
 *
 * Three attempts rather than five because the failures worth retrying resolve
 * in well under a second, and the ones that do not are outages. Retrying an
 * outage five times converts a fast error into a slow one and nothing else.
 */
const BACKOFF = Schedule.exponential(Duration.millis(50), 2).pipe(
  Schedule.jittered,
);

const RETRIES = 2;

/**
 * The abandoned attempt, as a value.
 *
 * A sentinel rather than a `RepositoryFailure` because it has to survive as far
 * as the retry predicate, which needs to know that *this* failure was a timeout
 * and not something the driver said. Translated at the end, like everything
 * else.
 */
const TIMED_OUT = Symbol.for("oklaw/sql/timeout");

type Abandoned = typeof TIMED_OUT;

const retryable =
  (replayable: boolean) =>
  (error: unknown): boolean => {
    if (error === TIMED_OUT) return replayable;

    const codes = codesIn(error);
    const safeForAnything = codes.some(
      (code) => NEVER_RAN.has(code) || ROLLED_BACK.has(code),
    );

    if (safeForAnything) return true;
    return replayable && codes.some((code) => OUTCOME_UNKNOWN.has(code));
  };

/**
 * Timeout, retry and span, leaving the driver's own error in place.
 *
 * The handful of writes that need it directly: they translate a unique-index
 * refusal into a domain error — `CaseNumberTaken`, `InvoiceNumberTaken` — and
 * that translation has to read the SQLSTATE, which `RepositoryFailure` has
 * already thrown away. They pipe through this and then map the error
 * themselves.
 *
 * Everything else goes through `reading` or `writing`, which are this plus the
 * translation.
 */
export const guarded =
  (operation: string, { replayable }: { readonly replayable: boolean }) =>
  <A, E, R>(
    query: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | SqlError.SqlError, R> => {
    /**
     * Inside the retry, so the budget is *per attempt*. Outside it, three
     * attempts would share five seconds and the third would be given whatever
     * was left, which is usually nothing — a retry policy that stops retrying
     * under load, which is exactly when it is needed.
     */
    const attempt: Effect.Effect<A, E | Abandoned, R> = Effect.timeoutFail(
      query,
      { duration: ATTEMPT, onTimeout: (): Abandoned => TIMED_OUT },
    );

    const attempts: Effect.Effect<A, E | Abandoned, R> = Effect.retry(attempt, {
      schedule: BACKOFF,
      times: RETRIES,
      while: retryable(replayable),
    });

    return attempts.pipe(
      /**
       * The abandoned attempt rejoins the driver's own error type, because
       * that is what it is: the database did not answer. Callers that
       * translate a SQLSTATE afterwards see a `SqlError` carrying no code,
       * match nothing, and fall through to `RepositoryFailure` — which is the
       * correct reading of a timeout.
       */
      Effect.mapError((error): E | SqlError.SqlError =>
        error === TIMED_OUT
          ? new SqlError.SqlError({
              message: `no answer within ${Duration.format(ATTEMPT)}`,
            })
          : error,
      ),
      /**
       * The span wraps the retries rather than each attempt, because the
       * question a trace is being read to answer is "why did this page take
       * four seconds", and the answer — *it was tried three times* — is
       * visible only from outside. `@effect/sql` opens a span per statement
       * underneath, so the attempts are still individually there.
       */
      Effect.withSpan(operation, { attributes: { "db.system": "postgresql" } }),
    );
  };

/**
 * A statement that only reads.
 *
 * Retried on anything transient, including a timeout and a connection that
 * dropped mid-flight, because the worst a replay can do is cost another round
 * trip.
 *
 * The operation name is qualified — `CaseRepository.byId`, not `byId` — and
 * that is a change worth its diff. It becomes both the span name in a trace and
 * `RepositoryFailure.operation` in a log, and eight repositories have a `byId`.
 * An alert saying "byId failed" names nothing.
 */
export const reading =
  (operation: string) =>
  <A, R>(
    query: Effect.Effect<A, QueryFailure, R>,
  ): Effect.Effect<A, RepositoryFailure, R> =>
    query.pipe(
      guarded(operation, { replayable: true }),
      Effect.mapError(failure(operation)),
    );

/**
 * A statement that writes.
 *
 * Retried only where the previous attempt provably did nothing — a refused
 * connection, a full pool, a transaction Postgres rolled back itself. A dropped
 * connection or a timeout is *not* retried here, and the asymmetry is the
 * entire point of having two functions: those cases cannot distinguish "the
 * write did not happen" from "the write happened and the answer was lost", and
 * one of those two readings posts a payment twice.
 *
 * A write that fails that way surfaces as a `RepositoryFailure`, which the
 * screen renders as "nothing was saved; try again" — a person deciding to
 * retry, having seen the state, rather than this module deciding for them.
 */
export const writing =
  (operation: string) =>
  <A, R>(
    query: Effect.Effect<A, QueryFailure, R>,
  ): Effect.Effect<A, RepositoryFailure, R> =>
    query.pipe(
      guarded(operation, { replayable: false }),
      Effect.mapError(failure(operation)),
    );

/**
 * A transaction, retried when Postgres rolled it back itself.
 *
 * `Transactor` wraps several statements in one `BEGIN`, and each of those
 * statements already carries its own budget and its own retry through `reading`
 * or `writing`. What it cannot do from the inside is recover from a deadlock:
 * `40P01` aborts the *transaction*, so the statement-level retry re-runs a
 * statement in a transaction that no longer exists.
 *
 * Only `ROLLED_BACK` applies here, and that restriction is what makes this safe
 * on a transaction that moves client money. Those two codes mean Postgres
 * discarded the work and said so — there is nothing half-applied, by definition
 * of what a rollback is. Nothing else is retried: a transaction that failed for
 * any other reason may have committed some of itself before the wrapper
 * noticed, and replaying it would be the double-posting this module exists to
 * refuse.
 *
 * No timeout of its own, deliberately. A transaction is as long as its
 * statements, each of which is budgeted; a second budget over the whole thing
 * would abandon a legitimate four-statement write on a cold start, which is a
 * cure worse than the disease.
 */
export const contended = <A, E, R>(
  work: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.retry(work, {
    schedule: BACKOFF,
    times: RETRIES,
    while: (error: E) => codesIn(error).some((code) => ROLLED_BACK.has(code)),
  });
