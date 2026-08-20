import { SqlClient } from "@effect/sql";
import { Effect, Layer } from "effect";
import { RepositoryFailure, Transactor } from "../../services/repositories";

/**
 * `Transactor`, over `@effect/sql`.
 *
 * The whole implementation is `sql.withTransaction`, which raises the obvious
 * question of why the interface exists at all. Because of where it is used: a
 * service that reached for `sql.withTransaction` directly would be a service
 * that imports `@effect/sql`, and every test of that service would then need a
 * database — including the tests of rules that have nothing to do with storage.
 * The indirection costs this file and buys `case-service.test.ts` running in
 * 250ms against arrays.
 *
 * The failure translation matters as much as the transaction. `withTransaction`
 * adds `SqlError` to whatever the wrapped effect can fail with, and a service
 * must not have to know that name — so it becomes `RepositoryFailure`, which is
 * the one word `services/` uses for "the store refused", exactly as every
 * repository in this directory already does.
 */

const isSqlError = (error: unknown): error is { readonly message: string } =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  error._tag === "SqlError";

export const TransactorLive = Layer.effect(
  Transactor,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    return Transactor.of({
      transaction: (effect) =>
        sql.withTransaction(effect).pipe(
          Effect.mapError((error) =>
            isSqlError(error)
              ? new RepositoryFailure({
                  operation: "transaction",
                  detail: error.message,
                })
              : error,
          ),
        ),
    });
  }),
);
