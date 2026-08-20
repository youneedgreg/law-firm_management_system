import { Effect, Option } from "effect";
import * as Audit from "../domain/audit/entry";
import type { Principal } from "../domain/identity/principal";
import { AuditLog } from "./audit-service";
import { NotAuthenticated } from "./policy";
import {
  type InvalidCredentials,
  type RepositoryFailure,
  type SessionCookie,
  SessionGateway,
  UserRepository,
} from "./repositories";

/**
 * Who is calling, and what the sign-in endpoints do.
 *
 * The division of labour worth being clear about: `SessionGateway` (Better
 * Auth, in `infra/auth/`) answers "is this cookie a live session, and whose".
 * This service answers "and who is that", which is a join to `advocates` or
 * `clients` that Better Auth knows nothing about — and it is the layer where a
 * sign-in becomes an audit entry.
 */

/**
 * Which authentication endpoint a request is for.
 *
 * Matched on the path suffix rather than parsed, because the base path is
 * Better Auth's to choose and the endpoints are stable. A path this does not
 * recognise is passed through and simply not audited, which is the right
 * default: a new endpoint appearing in a library upgrade should not stop
 * working because this file has not heard of it.
 */
const endpoint = (request: Request): "sign-in" | "sign-out" | "other" => {
  const path = new URL(request.url).pathname;
  if (path.endsWith("/sign-in/email")) return "sign-in";
  if (path.endsWith("/sign-out")) return "sign-out";
  return "other";
};

export class IdentityService extends Effect.Service<IdentityService>()(
  "IdentityService",
  {
    effect: Effect.gen(function* () {
      const sessions = yield* SessionGateway;
      const users = yield* UserRepository;
      const audit = yield* AuditLog;

      /**
       * The principal behind a request's cookies, if there is one.
       *
       * A live session whose user row has since gone is treated as no session
       * at all rather than as an error. It happens when a login is deleted
       * while its holder is signed in, and the honest answer to "who is this"
       * is nobody — a 500 would be a worse answer, and a session that keeps
       * working would be a much worse one.
       */
      const identify = (
        headers: Headers,
      ): Effect.Effect<Option.Option<Principal>, RepositoryFailure> =>
        sessions.identify(headers).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.succeedNone,
              onSome: (userId) =>
                users.principalOf(userId).pipe(
                  Effect.map(Option.some),
                  Effect.catchTag("NotFound", () => Effect.succeedNone),
                ),
            }),
          ),
        );

      /**
       * Recording a session event must not be able to fail one.
       *
       * A deliberate trade in one direction, and only here: it applies to the
       * events recorded *around* an operation this service does not own, and
       * not to the mutations in `CaseService`, where the write and its audit
       * entry share a transaction. Refusing to let anybody sign in because the
       * audit table is unavailable would be an outage caused by the safeguard.
       */
      const recorded = (
        entry: Effect.Effect<void, RepositoryFailure>,
      ): Effect.Effect<void> =>
        entry.pipe(
          Effect.catchAll((failure) =>
            Effect.logError("Session event not audited").pipe(
              Effect.annotateLogs({ reason: failure.reason }),
            ),
          ),
        );

      return {
        identify,

        /**
         * Signs in, and records the attempt either way.
         *
         * The refused case is the one worth having: a run of
         * `session.refused` entries against one address at three in the
         * morning is the single most useful line an audit trail can produce,
         * and it exists only because the failure is recorded rather than
         * merely returned.
         *
         * The cookies come back for the caller to write. This service has no
         * response to attach them to, and the two callers that do — a Server
         * Action and a route handler — attach them differently.
         */
        signIn: (credentials: {
          readonly email: string;
          readonly password: string;
        }): Effect.Effect<
          readonly SessionCookie[],
          InvalidCredentials | RepositoryFailure
        > =>
          sessions.signIn(credentials).pipe(
            Effect.tapError((failure) =>
              failure._tag === "InvalidCredentials"
                ? recorded(
                    audit.recordSession(
                      Audit.attemptedBy(credentials.email),
                      "session.refused",
                    ),
                  )
                : Effect.void,
            ),
            Effect.tap((signedIn) =>
              users.principalOf(signedIn.userId).pipe(
                Effect.flatMap((principal) =>
                  audit.recordSession(
                    Audit.actorOf(principal),
                    "session.signed-in",
                    principal.userId,
                  ),
                ),
                /**
                 * A sign-in that cannot be attributed is still recorded,
                 * against the address that was typed. Better a line saying
                 * somebody signed in and we could not say who, than no line.
                 */
                Effect.catchTag("NotFound", () =>
                  audit.recordSession(
                    Audit.attemptedBy(credentials.email),
                    "session.signed-in",
                  ),
                ),
                recorded,
              ),
            ),
            Effect.map((signedIn) => signedIn.cookies),
          ),

        /**
         * Signs out, and records who did.
         *
         * The principal is read *before* the session is ended, which is the
         * only moment it is knowable — afterwards the cookie is no longer a
         * session and there is nobody to name.
         */
        signOut: (
          headers: Headers,
        ): Effect.Effect<readonly SessionCookie[], RepositoryFailure> =>
          Effect.gen(function* () {
            const before = yield* identify(headers);
            const cookies = yield* sessions.signOut(headers);

            yield* recorded(
              Option.match(before, {
                onNone: () => Effect.void,
                onSome: (principal) =>
                  audit.recordSession(
                    Audit.actorOf(principal),
                    "session.signed-out",
                    principal.userId,
                  ),
              }),
            );

            return cookies;
          }),

        /** `identify`, where being signed out is a failure rather than a value. */
        required: (
          headers: Headers,
        ): Effect.Effect<Principal, NotAuthenticated | RepositoryFailure> =>
          identify(headers).pipe(
            Effect.flatMap(
              Option.match({
                onNone: () => Effect.fail(new NotAuthenticated()),
                onSome: Effect.succeed<Principal>,
              }),
            ),
          ),

        /**
         * The remaining authentication endpoints — password reset, and
         * whatever the library adds next.
         *
         * **Sign-in and sign-out are refused here**, and that refusal is a
         * security control rather than tidiness. Both are audited by the
         * operations above, and an endpoint that reaches the same session
         * machinery without passing through them would be a way to sign in
         * that leaves no trace — which is precisely the way an attacker who
         * has read the source would choose. One door per operation, so there
         * is one place the audit entry can be written and no second path to
         * remember.
         */
        handle: (
          request: Request,
        ): Effect.Effect<Response, RepositoryFailure> =>
          endpoint(request) === "other"
            ? sessions.handle(request)
            : Effect.succeed(
                new Response(
                  JSON.stringify({
                    message:
                      "This application signs in and out through its own " +
                      "form, so that both are audited",
                  }),
                  {
                    status: 404,
                    headers: { "content-type": "application/json" },
                  },
                ),
              ),
      };
    }),
  },
) {}
