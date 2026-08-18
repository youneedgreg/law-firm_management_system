import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { PgMigrator } from "@effect/sql-pg";
import { Effect, Layer } from "effect";
import { PgLive } from "./client";
import { migrations } from "./migrations";

/**
 * Applies pending migrations. Run with `npm run db:migrate`.
 *
 * Deliberately a standalone script rather than something the app does on boot.
 * Migrating from a serverless function means several instances racing to alter
 * the same schema on a cold start, and a deploy that half-migrates is worse
 * than one that refuses to start.
 */
const MigratorLive = PgMigrator.layer({
  loader: migrations,
  table: "migrations",
}).pipe(Layer.provide(PgLive), Layer.provide(NodeContext.layer));

const program = Effect.gen(function* () {
  yield* Effect.logInfo("Applying migrations…");
  yield* Layer.build(MigratorLive);
  yield* Effect.logInfo("Database is up to date.");
}).pipe(Effect.scoped);

NodeRuntime.runMain(program);
