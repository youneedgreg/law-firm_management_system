import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";
import { CaseService } from "../../services/case-service";
import { OkLawApi } from "../contract";
import { driverFailure } from "./internal";

/**
 * The cases group, implemented.
 *
 * Every handler is three lines, and that is the point: the contract already
 * said what comes in and what goes out, `CaseService` already holds the rules,
 * and nothing is left for this layer to do except call one with the other.
 * There is no validation here, no error mapping beyond hiding the driver, and
 * no shape-building — a handler that reached for a repository or rephrased a
 * refusal would be application logic that had escaped into the transport, and
 * the next delivery mechanism would need its own copy.
 *
 * The payload and path arrive **already decoded** — `id` is a `CaseId`, not a
 * string that looks like one, and `openedOn` is a `Date`. A malformed one never
 * reaches this file; it is a 400 with the offending field named, produced by
 * the schema in the contract.
 */
export const CasesHandlers = HttpApiBuilder.group(
  OkLawApi,
  "cases",
  (handlers) =>
    Effect.gen(function* () {
      const cases = yield* CaseService;

      return handlers
        .handle("caseload", ({ urlParams }) =>
          cases
            .caseload(urlParams)
            .pipe(Effect.catchTag("RepositoryFailure", driverFailure)),
        )
        .handle("intakeChoices", () =>
          cases
            .intakeChoices()
            .pipe(Effect.catchTag("RepositoryFailure", driverFailure)),
        )
        .handle("file", ({ path }) =>
          cases
            .file(path.id)
            .pipe(Effect.catchTag("RepositoryFailure", driverFailure)),
        )
        .handle("open", ({ payload }) =>
          cases
            .open(payload)
            .pipe(Effect.catchTag("RepositoryFailure", driverFailure)),
        )
        .handle("amend", ({ path, payload }) =>
          cases
            .amend(path.id, payload)
            .pipe(Effect.catchTag("RepositoryFailure", driverFailure)),
        )
        .handle("transition", ({ path, payload }) =>
          cases
            .transition(path.id, payload.to)
            .pipe(Effect.catchTag("RepositoryFailure", driverFailure)),
        );
    }),
);
