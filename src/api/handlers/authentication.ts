import { HttpServerRequest } from "@effect/platform";
import { Effect, Layer } from "effect";
import { IdentityService } from "../../services/identity-service";
import { Authentication } from "../authentication";
import { driverFailure } from "./internal";

/**
 * The middleware, implemented: a cookie in, a principal out.
 *
 * It reads the request's headers and hands them to `IdentityService`, which
 * verifies the session through the gateway and resolves the user to a
 * principal. Nothing about Better Auth appears here, and nothing about cookies
 * appears past here.
 *
 * `HttpServerRequest` is available because a middleware runs with
 * `HttpRouter.Provided` in context — the same services a handler has. That is
 * what lets this be a Layer rather than a function every handler has to
 * remember to call.
 */
export const AuthenticationLive = Layer.effect(
  Authentication,
  Effect.gen(function* () {
    const identity = yield* IdentityService;

    return Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;

      /**
       * A request with no session is 401 — including one whose session cookie
       * is for a user that no longer exists, which `identify` reports as no
       * session rather than as an error.
       *
       * A database failure while checking is *not* 401. It is the driver
       * failure every other operation treats as a defect, because answering
       * "you are not signed in" when the truth is "we could not tell" is how a
       * degraded database becomes an authentication bypass in the other
       * direction: it trains people to sign in again, over and over, at exactly
       * the moment something is wrong.
       */
      return yield* identity
        .required(new Headers(request.headers))
        .pipe(Effect.catchTag("RepositoryFailure", driverFailure));
    });
  }),
);
