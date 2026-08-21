import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";
import { BillingService } from "../../services/billing-service";
import { OkLawApi } from "../contract";
import { driverFailure } from "./internal";

/**
 * The billing endpoints.
 *
 * Every handler is one call into `BillingService` and one `catchTag` for the
 * driver failure. That thinness is the point: the rules — Rule 10, the
 * overpayment guard, the duplicate confirmation, which role may move client
 * money — all live in the service and the domain, so a second transport over
 * the same service would enforce exactly the same things without restating any
 * of them. A handler that reached for a repository, or checked a permission of
 * its own, would be application logic living in the transport.
 */
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
        )
        .handle("receivables", () =>
          billing
            .receivables()
            .pipe(Effect.catchTag("RepositoryFailure", driverFailure)),
        )
        .handle("ledger", ({ path }) =>
          billing
            .ledger(path.clientId)
            .pipe(Effect.catchTag("RepositoryFailure", driverFailure)),
        )
        .handle("raise", ({ payload }) =>
          billing
            .raise(payload)
            .pipe(Effect.catchTag("RepositoryFailure", driverFailure)),
        )
        .handle("raiseFromTime", ({ path, payload }) =>
          billing
            .raiseFromTime(path.caseId, payload)
            .pipe(Effect.catchTag("RepositoryFailure", driverFailure)),
        )
        .handle("recordPayment", ({ path, payload }) =>
          billing
            .recordPayment(path.id, payload)
            .pipe(Effect.catchTag("RepositoryFailure", driverFailure)),
        )
        .handle("settle", ({ path, payload }) =>
          billing
            .settle(path.id, payload)
            .pipe(Effect.catchTag("RepositoryFailure", driverFailure)),
        )
        .handle("deposit", ({ payload }) =>
          billing
            .deposit(payload)
            .pipe(Effect.catchTag("RepositoryFailure", driverFailure)),
        );
    }),
);
