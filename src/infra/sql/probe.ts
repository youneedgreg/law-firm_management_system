import { SqlClient } from "@effect/sql";
import { Duration, Effect, Layer } from "effect";
import { DatabaseProbe, RepositoryFailure } from "../../services/repositories";
import { within } from "../budget";
import { failure } from "./failure";

/**
 * `SELECT 1`, and the two decisions that make it a health check rather than a
 * query.
 *
 * ## It is not retried
 *
 * Every other statement in this directory goes through `reading` or `writing`,
 * which retry a transient failure up to three times. This one deliberately does
 * not, and the reason is what the answer is *for*: a monitor is asking whether
 * the database is reachable **now**. A probe that quietly retried for four
 * seconds and then reported success would be describing a database that
 * eventually answered, which is a different and much less useful claim — and it
 * would hide precisely the intermittent failure a monitor exists to catch.
 *
 * ## Its budget is the same as everything else's, and that was a correction
 *
 * The first version gave it two seconds on the reasoning that a monitor has its
 * own timeout and a probe answering after the poller has given up answers
 * nobody. Measuring it against Neon settled the argument the other way: a
 * cold start took **1.8 seconds** on a warm-ish instance and longer from
 * scaled-to-zero, so a two-second probe reports `degraded` for a deployment
 * that would have served the page perfectly well.
 *
 * A health check that disagrees with the application it is checking is worse
 * than no health check, because somebody is paged for it. So the budget is the
 * five seconds any other statement gets: **if a page would have succeeded, this
 * says `ok`.**
 *
 * Latency is reported separately, as `ms`, precisely so that "reachable but
 * slow" does not have to be squeezed into the verdict. Anything that cares can
 * alert on the number.
 */
const OPERATION = "DatabaseProbe.ping";
const BUDGET = Duration.seconds(5);

export const DatabaseProbeLive = Layer.effect(
  DatabaseProbe,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    return DatabaseProbe.of({
      ping: () =>
        sql`SELECT 1`.pipe(
          Effect.timed,
          Effect.map(([elapsed]) => elapsed),
          Effect.mapError(failure(OPERATION)),
          within({
            operation: OPERATION,
            duration: BUDGET,
            onTimeout: (detail) =>
              new RepositoryFailure({ operation: OPERATION, detail }),
          }),
        ),
    });
  }),
);
