import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";
import { BillingService } from "../../services/billing-service";
import { OkLawApi } from "../contract";
import { driverFailure } from "./internal";

export const BillingHandlers = HttpApiBuilder.group(
  OkLawApi,
  "billing",
  (handlers) =>
    Effect.gen(function* () {
      const billing = yield* BillingService;

      return handlers
        .handle("forClient", ({ path }) =>
          billing
            .forClient(path.clientId)
            .pipe(Effect.catchTag("RepositoryFailure", driverFailure)),
        )
        .handle("invoice", ({ path }) =>
          billing
            .invoice(path.id)
            .pipe(Effect.catchTag("RepositoryFailure", driverFailure)),
        );
    }),
);
