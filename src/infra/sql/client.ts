import { PgClient } from "@effect/sql-pg";
import { Effect, Layer, String as Str } from "effect";
import { PgPool, PgPoolLive } from "./pool";

/**
 * The Postgres connection, as a Layer.
 *
 * Being a Layer is the point. Nothing in `services/` imports this file; a
 * service declares that it needs `SqlClient`, and this is one way to provide
 * one. A test provides a different way — a throwaway container in Phase 12, or
 * no database at all where an in-memory repository will do — and the code under
 * test never learns the difference.
 *
 * The name transforms let SQL read like SQL and TypeScript read like
 * TypeScript: `claim_value_cents` in a query arrives as `claimValueCents` in a
 * row, and neither side has to carry the other's convention.
 *
 * Built `fromPool` since Phase 6 rather than from a URL, because Better Auth
 * needs a connection to the same database and taking it from `PgPool` is what
 * keeps that from being a second pool. See `pool.ts`.
 */
export const PgLive = Layer.unwrapEffect(
  Effect.gen(function* () {
    const pool = yield* PgPool;

    return PgClient.layerFromPool({
      acquire: Effect.succeed(pool),
      /** Columns come back `snake_case`; fields are `camelCase`. */
      transformResultNames: Str.snakeToCamel,
      /** …and identifiers written `camelCase` go out as `snake_case`. */
      transformQueryNames: Str.camelToSnake,
      /** Shows up in Neon's dashboard, which helps when a query is slow. */
      applicationName: "oklaw",
    });
  }),
).pipe(Layer.provide(PgPoolLive));
