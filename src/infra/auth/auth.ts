import { betterAuth } from "better-auth";
import { Context, Effect, Layer, Redacted } from "effect";
import type Pg from "pg";
import { AuthConfig } from "../config";
import { PgPool, PgPoolLive } from "../sql/pool";
import { AUTH_OPTIONS } from "./options";

/**
 * Better Auth, as a service.
 *
 * The library's own examples build the instance at module scope and export it.
 * That works, and it puts the one object that reads the signing secret and owns
 * the session table outside every mechanism this codebase uses to control
 * construction: it would build itself on import, in a test that meant to
 * provide a fake, on a machine with no `DATABASE_URL`, and it would open its
 * own pool while doing it.
 *
 * As a Layer it is constructed once, from the same pool as everything else, and
 * a test can provide a different one. It is also the reason the sign-in route
 * looks like every other route in this application — it goes through the
 * runtime.
 */

export type AuthInstance = ReturnType<typeof make>;

const make = (pool: Pg.Pool, secret: string, baseUrl: string) =>
  betterAuth({
    ...AUTH_OPTIONS,

    /**
     * The same pool `PgClient` uses. Passing a connection string here instead
     * would be a second pool against the same database — see `sql/pool.ts`.
     */
    database: pool,
    secret,
    baseURL: baseUrl,

    /**
     * Off, explicitly. Better Auth's telemetry is opt-in and this changes
     * nothing at runtime; it is written down because "does this send anything
     * anywhere" is a question a firm's IT policy asks about every dependency,
     * and the answer should be in the code rather than in a changelog.
     */
    telemetry: { enabled: false },

    emailAndPassword: {
      ...AUTH_OPTIONS.emailAndPassword,

      /**
       * There is no email provider in this stack yet, so the reset link is
       * logged rather than sent.
       *
       * This is a real gap and is stated as one: on a deployment where logs are
       * readable by more people than mailboxes are, a reset link in a log is a
       * password reset anybody with log access can complete. It is acceptable
       * *here* because this is a portfolio deployment with seeded accounts and
       * no real client data — and it is wired this way rather than left
       * unimplemented because the rest of the flow (single-use token, expiry,
       * the session rotation that follows) is real, and it is the part worth
       * having working when Phase 7 adds a mail transport.
       */
      sendResetPassword: ({ user, url }) =>
        Effect.runPromise(
          Effect.logInfo("Password reset requested").pipe(
            Effect.annotateLogs({ email: user.email, resetUrl: url }),
          ),
        ),
    },
  });

export class Auth extends Context.Tag("oklaw/Auth")<Auth, AuthInstance>() {}

export const AuthLive = Layer.effect(
  Auth,
  Effect.gen(function* () {
    const pool = yield* PgPool;
    const config = yield* AuthConfig;

    return make(pool, Redacted.value(config.secret), config.baseUrl);
  }),
).pipe(Layer.provide(PgPoolLive), Layer.provide(AuthConfig.Default));
