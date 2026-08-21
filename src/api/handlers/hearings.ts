import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";
import { HearingService } from "../../services/hearing-service";
import { OkLawApi } from "../contract";
import { driverFailure } from "./internal";

export const HearingsHandlers = HttpApiBuilder.group(
  OkLawApi,
  "hearings",
  (handlers) =>
    Effect.gen(function* () {
      const hearings = yield* HearingService;

      return handlers
        .handle("diary", () =>
          hearings
            .diary()
            .pipe(Effect.catchTag("RepositoryFailure", driverFailure)),
        )
        .handle("list", ({ payload }) =>
          hearings
            .list(payload)
            .pipe(Effect.catchTag("RepositoryFailure", driverFailure)),
        )
        .handle("record", ({ path, payload }) =>
          hearings
            .record(path.id, payload)
            .pipe(Effect.catchTag("RepositoryFailure", driverFailure)),
        );
    }),
);
