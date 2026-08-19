import { NodeRuntime } from "@effect/platform-node";
import { Effect } from "effect";
import { seed, SeedLayer } from "./program";

/**
 * The `npm run db:seed` entry point, and nothing else.
 *
 * The program itself lives next door so a test can run it. A module that calls
 * `runMain` at import time cannot be imported by anything — including the test
 * that would prove it works.
 */
NodeRuntime.runMain(seed.pipe(Effect.provide(SeedLayer)));
