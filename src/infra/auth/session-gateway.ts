import { isAPIError } from "better-auth/api";
import { parseSetCookieHeader, toCookieOptions } from "better-auth/cookies";
import { Effect, Layer, Option, Schema } from "effect";
import { UserId } from "../../domain/shared/ids";
import {
  InvalidCredentials,
  RepositoryFailure,
  type SessionCookie,
  SessionGateway,
} from "../../services/repositories";
import { Auth, AuthLive } from "./auth";

/**
 * `SessionGateway`, over Better Auth.
 *
 * The adapter is thin on purpose. Everything above it — who the principal is,
 * what they may do, what gets audited — is this codebase's, and the only thing
 * delegated is the part ADR 0004 decided not to write: verifying a signed
 * session cookie, and the password hashing behind the endpoints `handle`
 * serves.
 *
 * That thinness is what makes the library replaceable. If Better Auth is ever
 * swapped out, this file and `auth.ts` are what change; no service, no route
 * and no test touches it, because none of them can name it.
 */

/**
 * A session's user id, as the domain's branded `UserId`.
 *
 * Decoded rather than cast, even though Better Auth generated it and
 * `advanced.database.generateId` makes it a UUID. The cast would be right today
 * and would go on compiling on the day that option is changed, dropped, or
 * overridden by a plugin — and the failure would then be a `NotFound` for a
 * user who exists, which is a genuinely miserable thing to debug.
 */
const asUserId = Schema.decodeUnknown(UserId);

/**
 * The cookies a response asks the browser to set, as values.
 *
 * `getSetCookie()` rather than `get("set-cookie")`: a sign-in sets more than
 * one cookie, and the joined form of a `Set-Cookie` header cannot be split on
 * commas safely — an `Expires` attribute contains one.
 */
const cookiesOf = (response: Response): readonly SessionCookie[] =>
  response.headers.getSetCookie().flatMap((header) =>
    [...parseSetCookieHeader(header)].map(
      ([name, attributes]): SessionCookie => ({
        name,
        value: attributes.value,
        options: toCookieOptions(attributes),
      }),
    ),
  );

/** The user id in a sign-in response body, without trusting its shape. */
const userIdIn = (body: unknown): unknown =>
  typeof body === "object" &&
  body !== null &&
  "user" in body &&
  typeof body.user === "object" &&
  body.user !== null &&
  "id" in body.user
    ? body.user.id
    : undefined;

export const SessionGatewayLive = Layer.effect(
  SessionGateway,
  Effect.gen(function* () {
    const auth = yield* Auth;

    return SessionGateway.of({
      identify: (headers) =>
        Effect.tryPromise({
          try: () => auth.api.getSession({ headers }),
          catch: (cause) =>
            new RepositoryFailure({
              operation: "identify",
              detail: String(cause),
            }),
        }).pipe(
          Effect.flatMap((session) =>
            session === null
              ? Effect.succeedNone
              : Effect.map(asUserId(session.user.id), Option.some),
          ),
          Effect.catchTag(
            "ParseError",
            (error) =>
              new RepositoryFailure({
                operation: "identify",
                detail: error.message,
              }),
          ),
        ),

      /**
       * Sign-in, called as a function rather than over HTTP.
       *
       * `asResponse: true` is what makes this usable from a Server Action: the
       * library answers with a `Response` carrying `Set-Cookie`, and the
       * cookies are handed back as values for the action to write. The
       * alternative — Better Auth's `nextCookies()` plugin, which reaches for
       * `next/headers` itself — would put a framework dependency inside the
       * one layer that is supposed to be replaceable.
       *
       * A non-2xx is `InvalidCredentials` and nothing more specific. Better
       * Auth distinguishes an unknown account from a wrong password in its
       * response, and that distinction is deliberately dropped here rather than
       * passed along.
       */
      signIn: ({ email, password }) =>
        Effect.tryPromise({
          try: () =>
            auth.api.signInEmail({
              body: { email, password },
              asResponse: true,
            }),
          catch: (cause) =>
            // Better Auth throws `APIError` for a refusal, which is a failure
            // of the credentials rather than of the database.
            isAPIError(cause)
              ? new InvalidCredentials()
              : new RepositoryFailure({
                  operation: "signIn",
                  detail: String(cause),
                }),
        }).pipe(
          Effect.flatMap((response) =>
            response.ok
              ? Effect.succeed(response)
              : Effect.fail(new InvalidCredentials()),
          ),
          Effect.flatMap((response) =>
            Effect.tryPromise({
              try: async () => {
                const body: unknown = await response.json();
                return { body, cookies: cookiesOf(response) };
              },
              catch: (cause) =>
                new RepositoryFailure({
                  operation: "signIn",
                  detail: String(cause),
                }),
            }),
          ),
          Effect.flatMap(({ body, cookies }) =>
            Effect.map(asUserId(userIdIn(body)), (userId) => ({
              userId,
              cookies,
            })),
          ),
          Effect.catchTag(
            "ParseError",
            (error) =>
              new RepositoryFailure({
                operation: "signIn",
                detail: error.message,
              }),
          ),
        ),

      /**
       * Sign-out, which succeeds whether or not there was a session.
       *
       * The cookies come back either way, because the point of the operation is
       * that the browser is not holding one afterwards — a stale cookie that
       * the server no longer honours is still a cookie that gets sent, and
       * still something a person would reasonably call "still signed in".
       */
      signOut: (headers) =>
        Effect.tryPromise({
          try: () => auth.api.signOut({ headers, asResponse: true }),
          catch: (cause) =>
            new RepositoryFailure({
              operation: "signOut",
              detail: String(cause),
            }),
        }).pipe(
          Effect.map(cookiesOf),
          Effect.orElseSucceed(() => []),
        ),

      /**
       * Better Auth's remaining endpoints, unmodified.
       *
       * A rejected promise becomes `RepositoryFailure` rather than propagating
       * as a defect: an authentication endpoint that cannot reach the database
       * is the same class of problem as a query that cannot, and the caller
       * already handles that one.
       */
      handle: (request) =>
        Effect.tryPromise({
          try: () => auth.handler(request),
          catch: (cause) =>
            new RepositoryFailure({
              operation: "auth handler",
              detail: String(cause),
            }),
        }),
    });
  }),
).pipe(Layer.provide(AuthLive));
