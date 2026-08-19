import { HttpApiBuilder, HttpServerResponse, OpenApi } from "@effect/platform";
import { Effect } from "effect";
import { OkLawApi } from "./contract";

/**
 * The OpenAPI document, generated from the contract.
 *
 * Not written, not annotated onto handlers, not kept in a `.yaml` beside the
 * code: `OpenApi.fromApi` reads the same `HttpApi` value the router and the
 * client are built from, so the document cannot describe an endpoint that does
 * not exist or miss one that does. A spec maintained by hand is a spec that is
 * wrong by the second sprint, and the failure is silent in the worst way —
 * whoever integrates against it finds out, not you.
 *
 * Served as JSON at a stable path so it can be linted, diffed in review, or fed
 * to a code generator for a consumer in another language. `/api/docs` renders
 * the same document for humans.
 */

/** Computed once at module load; the contract cannot change at runtime. */
const spec = OpenApi.fromApi(OkLawApi);

export const OpenApiRoute = HttpApiBuilder.Router.use((router) =>
  router.get(
    "/api/openapi.json",
    Effect.succeed(HttpServerResponse.unsafeJson(spec)),
  ),
);

/** Exposed so a test can assert the document describes what was declared. */
export const openApiSpec = spec;
