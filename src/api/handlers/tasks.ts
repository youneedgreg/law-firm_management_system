import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";
import { TaskService } from "../../services/task-service";
import { OkLawApi } from "../contract";
import { driverFailure } from "./internal";

/**
 * The work endpoints.
 *
 * Thin, like the others: every rule worth having is in the domain or the
 * service, and a handler that decided anything would be a second place to look
 * for it. `RepositoryFailure` dies rather than crossing the wire, because a
 * driver message can carry the query and therefore the values.
 */
export const TasksHandlers = HttpApiBuilder.group(
  OkLawApi,
  "tasks",
  (handlers) =>
    Effect.gen(function* () {
      const tasks = yield* TaskService;

      return handlers
        .handle("workList", () =>
          tasks
            .workList()
            .pipe(Effect.catchTag("RepositoryFailure", driverFailure)),
        )
        .handle("forCase", ({ path }) =>
          tasks
            .forCase(path.caseId)
            .pipe(Effect.catchTag("RepositoryFailure", driverFailure)),
        )
        .handle("raise", ({ payload }) =>
          tasks
            .raise(payload)
            .pipe(Effect.catchTag("RepositoryFailure", driverFailure)),
        )
        .handle("complete", ({ path }) =>
          tasks
            .complete(path.id)
            .pipe(Effect.catchTag("RepositoryFailure", driverFailure)),
        )
        .handle("reopen", ({ path }) =>
          tasks
            .reopen(path.id)
            .pipe(Effect.catchTag("RepositoryFailure", driverFailure)),
        )
        .handle("reassign", ({ path, payload }) =>
          tasks
            .reassign(path.id, payload.assignedTo)
            .pipe(Effect.catchTag("RepositoryFailure", driverFailure)),
        );
    }),
);
