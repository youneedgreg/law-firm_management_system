import { Effect } from "effect";
import type { RepositoryFailure } from "../../services/repositories";

/**
 * The one failure this API does not name.
 *
 * Every other refusal is a rule the caller can act on, and is declared on the
 * endpoint that can produce it. `RepositoryFailure` is not: it carries the
 * driver's own message, which can carry the query, and a query can carry a
 * client's name. It goes to the log — where somebody is meant to read it — and
 * the caller gets an empty 500.
 *
 * `Effect.die` rather than a declared error, and that choice is doing real
 * work. A defect is not part of the signature, so it cannot be caught by a
 * caller who has decided to "handle every error", and `@effect/platform`
 * answers it with `HttpServerResponse.empty({ status: 500 })` — no body at all,
 * so there is no encoder anywhere that could be talked into including the
 * detail. The same distinction Phase 3 drew between `run` and `attempt`, one
 * layer further out.
 */
export const driverFailure = (failure: RepositoryFailure) =>
  Effect.logError("Repository call failed").pipe(
    Effect.annotateLogs({
      operation: failure.operation,
      detail: failure.detail,
    }),
    Effect.andThen(Effect.die(new Error(`${failure.operation} failed`))),
  );
