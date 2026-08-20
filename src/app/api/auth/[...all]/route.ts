import { Effect } from "effect";
import { run } from "@/runtime";
import { IdentityService } from "@/services/identity-service";

/**
 * Better Auth's remaining endpoints.
 *
 * Sign-in and sign-out are **not** served here — `IdentityService.handle`
 * refuses them, because both are audited by the Server Actions in
 * `(auth)/sign-in/actions.ts` and a second path to the same session machinery
 * would be a way in that leaves no trace. What is left is the password-reset
 * flow and whatever the library adds next.
 *
 * Two things worth noticing about the file itself. It sits at
 * `/api/auth/[...all]`, which is more specific than the `[[...path]]` catch-all
 * serving the typed API, so Next routes to it first and the two do not fight.
 * And it goes through the same `run` as every other route: the auth instance is
 * a service in the same runtime, using the same connection pool, rather than a
 * module-level singleton with a pool of its own.
 */
const serve = (request: Request): Promise<Response> =>
  run(Effect.flatMap(IdentityService, (identity) => identity.handle(request)));

export const GET = serve;
export const POST = serve;
