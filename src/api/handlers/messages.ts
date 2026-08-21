import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";
import { MessageService } from "../../services/message-service";
import { OkLawApi } from "../contract";
import { driverFailure } from "./internal";

/** Correspondence. Thin, like the rest: the rules are in the service. */
export const MessagesHandlers = HttpApiBuilder.group(
  OkLawApi,
  "messages",
  (handlers) =>
    Effect.gen(function* () {
      const messages = yield* MessageService;

      return handlers
        .handle("thread", ({ path }) =>
          messages
            .thread(path.clientId)
            .pipe(Effect.catchTag("RepositoryFailure", driverFailure)),
        )
        .handle("waiting", () =>
          messages
            .waiting()
            .pipe(Effect.catchTag("RepositoryFailure", driverFailure)),
        )
        .handle("send", ({ payload }) =>
          messages
            .send(payload)
            .pipe(Effect.catchTag("RepositoryFailure", driverFailure)),
        );
    }),
);
