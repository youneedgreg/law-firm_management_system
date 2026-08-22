import { Effect, Option } from "effect";
import * as Audit from "../domain/audit/entry";
import type { Principal } from "../domain/identity/principal";
import * as Throttle from "../domain/identity/throttle";
import { AuditLog } from "./audit-service";
import { NotAuthenticated } from "./policy";
import {
  AttemptLimiter,
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
 * sign-in becomes an audit entry, and since Phase 8 the layer where an attempt
 * is counted.
 *
 * ## Better Auth has a limiter of its own, and it does not cover the thing that
 * matters
 *
 * Worth knowing before reading the throttle below, because it looks redundant
 * until you check. Better Auth enables rate limiting by default *in production*
 * — three requests per sixty seconds on `/request-password-reset`, three per
 * ten on `/sign-in`. Found by running the reset endpoint seven times and
 * getting a `429` on the fourth, from a limiter this codebase did not write.
 *
 * Two things follow, and they point the same way.
 *
 * **It does not protect sign-in here.** This application signs in through a
 * Server Action, and `handle` refuses `/sign-in/email` outright so that there
 * is one audited door. Better Auth's rule matches a path nothing reaches.
 *
 * **It is stored in memory.** Which on serverless is the control described in
 * `domain/identity/throttle.ts` as not being one: several instances, several
 * heaps, all of it forgotten on the next deploy.
 *
 * So it is left enabled — a per-instance limit costs nothing and is a
 * reasonable second line — and the durable limit is the one below.
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
const endpoint = (
  request: Request,
): "sign-in" | "sign-out" | "reset" | "other" => {
  const path = new URL(request.url).pathname;
  if (path.endsWith("/sign-in/email")) return "sign-in";
  if (path.endsWith("/sign-out")) return "sign-out";
  /**
   * Better Auth serves the same operation under two names, and both have to be
   * recognised — a limiter that knew only the current one would be a limiter
   * with a documented bypass.
   */
  if (
    path.endsWith("/request-password-reset") ||
    path.endsWith("/forget-password")
  ) {
    return "reset";
  }
  return "other";
};

export class IdentityService extends Effect.Service<IdentityService>()(
  "IdentityService",
  {
    effect: Effect.gen(function* () {
      const sessions = yield* SessionGateway;
      const users = yield* UserRepository;
      const audit = yield* AuditLog;
      const limiter = yield* AttemptLimiter;

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

      /**
       * Spends one attempt from each allowance and refuses if any is spent.
       *
       * The check is here rather than in the repository because it is a rule,
       * and rules live in `services/`. The repository counts; the allowance
       * comes from the domain; this is where the two meet.
       *
       * The refusal is audited under `session.throttled` rather than
       * `session.refused`, because those are different events and an incident
       * review turns on the difference: one is somebody who forgot their
       * password, the other is the control firing.
       */
      const throttled = (
        allowances: readonly Throttle.Allowance[],
        attemptedBy: string,
      ): Effect.Effect<void, Throttle.TooManyAttempts | RepositoryFailure> =>
        limiter
          .spend(allowances.map((allowance) => allowance.bucket))
          .pipe(
            Effect.flatMap((counts) =>
              allowances.some(
                (allowance) =>
                  (counts.get(allowance.bucket) ?? 0) > allowance.attempts,
              )
                ? recorded(
                    audit.recordSession(
                      Audit.attemptedBy(attemptedBy),
                      "session.throttled",
                    ),
                  ).pipe(Effect.andThen(Effect.fail(Throttle.refuse())))
                : Effect.void,
            ),
          );

      /**
       * Signs in, and records the attempt either way.
       *
       * The refused case is the one worth having: a run of `session.refused`
       * entries against one address at three in the morning is the single most
       * useful line an audit trail can produce, and it exists only because the
       * failure is recorded rather than merely returned.
       *
       * The cookies come back for the caller to write. This service has no
       * response to attach them to, and the two callers that do — a Server
       * Action and a route handler — attach them differently.
       *
       * Hoisted rather than written into the object below because
       * `signInAsDemo` is this operation with one more counter in front of it.
       * Two copies of the audit and throttle sequence would be two doors, which
       * is exactly what `handle` refuses `/sign-in/email` to prevent.
       */
      const signIn = (
        credentials: {
          readonly email: string;
          readonly password: string;
        },
        from: string,
      ): Effect.Effect<
        readonly SessionCookie[],
        InvalidCredentials | Throttle.TooManyAttempts | RepositoryFailure
      > =>
        Effect.suspend(() => {
          const allowances = Throttle.forSignIn(from, credentials.email);

          return throttled(allowances, credentials.email).pipe(
            Effect.andThen(sessions.signIn(credentials)),
            /**
             * The counters are forgotten on success, and only on success.
             * Otherwise somebody who mistypes their password four times and
             * then gets it right carries those four attempts for the rest of
             * the window, and is refused on their next visit for something
             * already resolved.
             *
             * `ignore`, because a limiter that cannot be cleared must not
             * fail a sign-in that has already succeeded — the session exists,
             * the cookies are in hand, and the worst case is that this
             * connection has fewer attempts left than it should.
             */
            Effect.tap(() =>
              Effect.ignore(
                limiter.forget(allowances.map((allowance) => allowance.bucket)),
              ),
            ),
          );
        }).pipe(
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
        );

      return {
        identify,
        signIn,

        /**
         * The same sign-in, with the counter the demo switcher needs (D-5).
         *
         * The one-click roster on the sign-in page presses a button rather than
         * typing a password, so every press *succeeds* — and `signIn` forgets
         * its counters on success, which is right when success means somebody
         * proved who they are and wrong when success is the thing being spent.
         * A loop on that button would open sessions and write audit rows
         * without limit, forgiven each time.
         *
         * So one more allowance goes in front of it, keyed on the source and
         * never forgotten. Everything else is the operation above, unchanged
         * and undivided: the password is still checked, the attempt is still
         * audited, and there is still one door.
         *
         * The credentials come from the caller rather than from here. The demo
         * password lives in `lib/`, which `services/` may not import — and that
         * boundary is doing real work in this instance, because a service that
         * knew a password would be a service with a way in that does not
         * involve checking one.
         */
        signInAsDemo: (
          credentials: {
            readonly email: string;
            readonly password: string;
          },
          from: string,
        ): Effect.Effect<
          readonly SessionCookie[],
          InvalidCredentials | Throttle.TooManyAttempts | RepositoryFailure
        > =>
          throttled(Throttle.forDemo(from), credentials.email).pipe(
            Effect.andThen(signIn(credentials, from)),
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
          from: string,
        ): Effect.Effect<
          Response,
          Throttle.TooManyAttempts | RepositoryFailure
        > =>
          endpoint(request) === "reset"
            ? throttled(Throttle.forReset(from), "password reset").pipe(
                Effect.andThen(sessions.handle(request)),
              )
            : endpoint(request) === "other"
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
