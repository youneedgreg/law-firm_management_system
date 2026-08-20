import { HttpApiMiddleware } from "@effect/platform";
import { CurrentUser } from "../services/policy";
import * as Failures from "./failures";

/**
 * Every endpoint runs as somebody.
 *
 * Declared as middleware rather than as a step inside each handler, and the
 * difference is not stylistic: `provides: CurrentUser` means the handlers can
 * *require* `CurrentUser`, and an endpoint whose middleware was forgotten would
 * not compile — its handler would have an unsatisfied requirement with nothing
 * left to provide it. Applied once to the whole API in `contract.ts`, so a
 * group added in Phase 7 inherits it instead of having to remember it.
 *
 * `failure: NotAuthenticated` is 401, and it is the only thing this middleware
 * can say. What a principal may then *do* is `NotPermitted`, raised by the
 * services, because authorization depends on the operation and this layer does
 * not know which one it is guarding. The two are separate for the same reason
 * they carry different status codes: signing in fixes one and never the other.
 *
 * It appears in the OpenAPI document as an error on every operation, which is
 * accurate — there is no unauthenticated endpoint on this API, including the
 * ones a public marketing page might want. When there is, it will be an
 * explicit exemption on that endpoint rather than a hole in the default.
 */
export class Authentication extends HttpApiMiddleware.Tag<Authentication>()(
  "oklaw/Authentication",
  {
    /**
     * The *annotated* schema, not the bare class.
     *
     * `Failures.NotAuthenticated` is the same error with `status: 401` on it,
     * and without that annotation `@effect/platform` answers a middleware
     * failure with 500 — which is how "you are not signed in" arrives as
     * "something broke", and how a test that expected 401 gets an empty
     * server error instead.
     */
    failure: Failures.NotAuthenticated,
    provides: CurrentUser,
  },
) {}
