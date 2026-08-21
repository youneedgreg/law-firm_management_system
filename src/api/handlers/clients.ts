import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";
import { ClientService } from "../../services/client-service";
import { OkLawApi } from "../contract";
import { driverFailure } from "./internal";

export const ClientsHandlers = HttpApiBuilder.group(
  OkLawApi,
  "clients",
  (handlers) =>
    Effect.gen(function* () {
      const clients = yield* ClientService;

      return handlers
        .handle("directory", () =>
          clients
            .directory()
            .pipe(Effect.catchTag("RepositoryFailure", driverFailure)),
        )
        .handle("screen", ({ payload }) =>
          clients
            .screen(payload)
            .pipe(Effect.catchTag("RepositoryFailure", driverFailure)),
        )
        .handle("takeOn", ({ payload }) =>
          clients
            .takeOn(payload)
            .pipe(Effect.catchTag("RepositoryFailure", driverFailure)),
        )
        .handle("amend", ({ path, payload }) =>
          clients
            .amend(path.id, payload)
            .pipe(Effect.catchTag("RepositoryFailure", driverFailure)),
        )
        .handle("file", ({ path }) =>
          clients
            .file(path.id)
            .pipe(Effect.catchTag("RepositoryFailure", driverFailure)),
        );
    }),
);
