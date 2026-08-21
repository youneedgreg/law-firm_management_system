import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";
import { DocumentService } from "../../services/document-service";
import { OkLawApi } from "../contract";
import { driverFailure } from "./internal";

/**
 * The document endpoints.
 *
 * `StorageFailure` is *not* caught and turned into a defect the way
 * `RepositoryFailure` is. That difference is deliberate: a driver message can
 * carry the query and therefore the values, so it dies; a storage failure says
 * only which operation failed, and a caller who knows the CDN rather than the
 * database was the problem can decide whether retrying is worth anything.
 */
export const DocumentsHandlers = HttpApiBuilder.group(
  OkLawApi,
  "documents",
  (handlers) =>
    Effect.gen(function* () {
      const documents = yield* DocumentService;

      return handlers
        .handle("register", () =>
          documents
            .register()
            .pipe(Effect.catchTag("RepositoryFailure", driverFailure)),
        )
        .handle("forCase", ({ path }) =>
          documents
            .forCase(path.caseId)
            .pipe(Effect.catchTag("RepositoryFailure", driverFailure)),
        )
        .handle("download", ({ path }) =>
          documents
            .download(path.id)
            .pipe(Effect.catchTag("RepositoryFailure", driverFailure)),
        )
        .handle("markFiled", ({ path }) =>
          documents
            .markFiled(path.id)
            .pipe(Effect.catchTag("RepositoryFailure", driverFailure)),
        );
    }),
);
