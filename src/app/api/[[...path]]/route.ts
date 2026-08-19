import { handle } from "@/api/server";

/**
 * Every `/api/*` request, handed to the Effect router.
 *
 * An optional catch-all, so one file serves the whole API: routing is the
 * contract's job, and a directory of `route.ts` files mirroring the endpoints
 * would be a second description of the paths — the one that disagrees when
 * somebody renames a segment in `contract.ts`.
 *
 * Each verb is exported separately rather than through a loop, because Next
 * discovers them by static analysis of the module's exports; a computed export
 * is not there as far as the compiler is concerned. `OPTIONS` is deliberately
 * absent — Next synthesises it from the verbs that are present, with the right
 * `Allow` header.
 *
 * The handler is typed as `(Request) => Promise<Response>`, which is precisely
 * what a route handler is. Nothing here unwraps `params`: the path was already
 * parsed by the schema in the contract, into a `CaseId` rather than a string
 * that looks like one.
 */

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const HEAD = handle;
