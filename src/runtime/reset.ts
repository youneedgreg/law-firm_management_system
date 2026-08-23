import { Effect, Either, Layer, ManagedRuntime } from "effect";
import { seed, SeedLayer } from "../infra/seed/program";
import { LoggingLive } from "../infra/telemetry/logging";
import { isDemoDeployment } from "./deployment";
import { runtime } from ".";

/**
 * Re-seeding the demonstration dataset from inside a running deployment (D-5).
 *
 * `npm run db:seed` is the same program with a different entry point: a script
 * under `tsx`, run by a person who has just changed a fixture. This one is run
 * by a cron trigger at midnight against the database a reviewer will open in
 * the morning, and the difference is one of environment rather than of
 * behaviour — which is why it is the same `seed`, not a copy of it that could
 * drift into resetting the demo to something the script no longer produces.
 *
 * ## Sharing the pool, not opening a second one
 *
 * `SeedLayer` contains `PgLive`, and the `ManagedRuntime` this deployment
 * already holds contains it too. Built independently they would be two
 * connection pools in one instance, each sized for the whole process, against a
 * Neon database with a connection limit — the same trap the API's web handler
 * sidesteps in `api/server.ts`. Passing the runtime's `memoMap` makes layer
 * construction shared: whichever asks for `PgLive` second gets the pool the
 * first one built.
 *
 * It is a *second* `ManagedRuntime` rather than a service on the first one, and
 * deliberately. `AppLayer` is what a page or an action may reach; a program
 * that empties `cases` has no business being reachable from there. The wiring
 * for it exists in this one file, is imported by one route, and that route
 * checks a shared secret before it runs.
 *
 * Held on `globalThis` for the reason every other singleton here is: Next
 * re-evaluates modules on each edit in development, and a module-level `const`
 * would build the seed's layers again on every save.
 */

const SEEDING = Symbol.for("oklaw.seed.runtime");

type SeedRuntime = ManagedRuntime.ManagedRuntime<
  Layer.Layer.Success<typeof SeedLayer>,
  Layer.Layer.Error<typeof SeedLayer>
>;

const holder = globalThis as unknown as { [SEEDING]?: SeedRuntime };

const seeding = (): SeedRuntime =>
  (holder[SEEDING] ??= ManagedRuntime.make(SeedLayer, runtime.memoMap));

/**
 * Runs the seed, handing back its failure as a value.
 *
 * `Effect.either` rather than a rejection: the caller is a route handler with a
 * status code to choose, and a cron trigger that receives a 500 with no body
 * learns nothing it can act on. The failure is a value here for the same reason
 * a refused form's is — somebody has to read it.
 *
 * **Logged here, and not through `reported`.** That helper grades a typed
 * failure by what kind of refusal it is, and grades anything it does not
 * recognise as `Debug`, on the argument that a rule saying no is the product
 * working. Nothing here is a refusal: every way this fails means the demo
 * dataset did not come back, and the visitor who arrives at nine to a firm with
 * no matters in it is the only person who will find out. So it is an error, at
 * `Error`, with what broke on the line.
 */
export const resetDemoData = async (): Promise<
  Either.Either<void, Layer.Layer.Error<typeof SeedLayer> | Error>
> => {
  /**
   * The lock that is not the door (D-11).
   *
   * `/api/cron/reset` checks this too, and checking it twice is the design
   * rather than an oversight. That route is one caller; *this* is the function
   * that empties twenty-three tables, and a guard belongs on the dangerous
   * operation rather than on the corridor leading to it. The next caller — a
   * script, an admin action, a test somebody writes in a hurry — inherits the
   * refusal without having to remember it.
   *
   * It runs before `seeding()`, so a deployment that is not the demo does not
   * build the seed's layers or open its pool to be told no.
   *
   * The log is at `Error` and says what happened rather than that a rule fired.
   * Nothing should ever reach this line: it means a nightly cron is registered
   * against an installation holding a real firm's records, which is a
   * misconfiguration somebody needs to go and fix tonight — not a routine
   * refusal to be counted.
   */
  if (!(await isDemoDeployment())) {
    /**
     * Logged through `LoggingLive` alone rather than through `runtime`.
     *
     * `runtime.runPromise` would build `AppLayer`, and `AppLayer` contains
     * `PgLive` — which would make *refusing* depend on Postgres being
     * reachable, so a deployment with a bad `DATABASE_URL` would throw here
     * instead of returning the refusal it is trying to return. `LoggingLive`
     * is `Layer<never, ConfigError>`: it reads the telemetry settings and
     * touches nothing else, so the refusal path stays as close to pure as a
     * log line gets.
     *
     * `ignore` because a failure to *describe* the refusal must not become a
     * failure to refuse. The only way that layer fails is a malformed
     * `LOG_LEVEL`, and a deployment in that state has larger problems than
     * this line.
     */
    await Effect.runPromise(
      Effect.logError(
        "A demo reset was attempted on a deployment that is not the demo",
      ).pipe(Effect.provide(LoggingLive), Effect.ignore),
    );

    return Either.left(
      new Error(
        "Refused: this deployment is not the demonstration, and the reset " +
          "empties every table the seed owns.",
      ),
    );
  }

  return seeding().runPromise(
    Effect.either(
      seed.pipe(
        Effect.tapError((failure) =>
          Effect.logError("The nightly demo reset failed").pipe(
            Effect.annotateLogs({
              reason:
                failure instanceof Error ? failure.message : String(failure),
            }),
          ),
        ),
        Effect.tap(() => Effect.logInfo("Demo dataset reset")),
      ),
    ),
  );
};
