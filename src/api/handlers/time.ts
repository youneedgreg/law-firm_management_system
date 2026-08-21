import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";
import { TimeService } from "../../services/time-service";
import { OkLawApi } from "../contract";
import { driverFailure } from "./internal";

/**
 * The time endpoints.
 *
 * Thin, like every other handler group: one call into `TimeService` and one
 * `catchTag` for the driver failure. Note what is *not* here — the timesheet
 * handler does not read the caller and pass their advocate id down. Attribution
 * is the service's, from `CurrentUser`, so a second transport cannot get it
 * wrong.
 */
export const TimeHandlers = HttpApiBuilder.group(OkLawApi, "time", (handlers) =>
  Effect.gen(function* () {
    const time = yield* TimeService;

    return handlers
      .handle("timesheet", ({ urlParams }) =>
        time
          .timesheet(urlParams)
          .pipe(Effect.catchTag("RepositoryFailure", driverFailure)),
      )
      .handle("workInProgress", () =>
        time
          .workInProgress()
          .pipe(Effect.catchTag("RepositoryFailure", driverFailure)),
      )
      .handle("record", ({ payload }) =>
        time
          .record(payload)
          .pipe(Effect.catchTag("RepositoryFailure", driverFailure)),
      )
      .handle("amend", ({ path, payload }) =>
        time
          .amend(path.id, payload)
          .pipe(Effect.catchTag("RepositoryFailure", driverFailure)),
      );
  }),
);
