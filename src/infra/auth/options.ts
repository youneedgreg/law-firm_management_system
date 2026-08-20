import type { BetterAuthOptions } from "better-auth";

/**
 * Everything Better Auth needs to know that does not depend on a database
 * connection or a secret.
 *
 * Separate from `auth.ts` so that it can be handed to `getSchema` in a test
 * with no pool, no environment and no network — which is what lets
 * `auth-schema.test.ts` compare what the library expects against what
 * migration 0005 creates. A config that could only be built by connecting to
 * Postgres could not be checked against the migration that has to run first.
 */

/**
 * Field maps: camelCase in the library, snake_case in the database.
 *
 * Written out in full rather than trusting the `casing: "snake"` option on the
 * Kysely adapter. Two reasons, and the second is the one that decided it:
 *
 * 1. The option is documented on the type as casing "for table names", and the
 *    same word is used elsewhere for columns. An ambiguity here produces a
 *    column that exists under a name nothing queries.
 * 2. These names are a contract with migration 0005, and a contract is worth
 *    more written down than inferred. When the test compares them, it compares
 *    two explicit lists — not a list against a transformation function, which
 *    would agree with itself by construction.
 */
export const SCHEMA_MAPPING = {
  user: {
    modelName: "users",
    fields: {
      emailVerified: "email_verified",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  session: {
    modelName: "sessions",
    fields: {
      userId: "user_id",
      expiresAt: "expires_at",
      ipAddress: "ip_address",
      userAgent: "user_agent",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  account: {
    modelName: "accounts",
    fields: {
      userId: "user_id",
      accountId: "account_id",
      providerId: "provider_id",
      accessToken: "access_token",
      refreshToken: "refresh_token",
      idToken: "id_token",
      accessTokenExpiresAt: "access_token_expires_at",
      refreshTokenExpiresAt: "refresh_token_expires_at",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  verification: {
    modelName: "verifications",
    fields: {
      expiresAt: "expires_at",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
} as const satisfies Pick<
  BetterAuthOptions,
  "user" | "session" | "account" | "verification"
>;

/** How long a session lasts, and how often using it extends it. */
export const SESSION_LIFETIME_DAYS = 7;
const SESSION_REFRESH_DAYS = 1;

/**
 * The options that do not depend on the environment.
 *
 * ## Sign-up is off, and that is a feature
 *
 * `disableSignUp` closes `/api/auth/sign-up/email` permanently. A law firm does
 * not have members of the public creating accounts: a login belongs to a member
 * of staff or to a client the firm has already taken on, and both already exist
 * as rows before there is anything to sign in to. Provisioning therefore runs
 * through `UserRepository`, which requires the link to one of them —
 * `users_exactly_one_subject` would refuse the row otherwise, so an open
 * sign-up endpoint could not have worked here even if it were wanted.
 *
 * ## Sessions are database rows, not JWTs
 *
 * Which is the default, and is worth stating because the alternative is
 * tempting and wrong for this system: a stateless token cannot be revoked. When
 * a laptop is lost or an employee leaves, "sign every session out now" has to
 * be a `DELETE`, and with a JWT it is a wait for expiry.
 */
/**
 * The cookie name prefix, set rather than defaulted.
 *
 * Better Auth derives it from `appName` when it is not given, which would make
 * the cookie `OKLaw.session_token` — capitals and all. It is stated here
 * because `proxy.ts` needs the same value to make its optimistic check, and a
 * name that is derived from something else is a name that changes when that
 * something else does.
 */
export const COOKIE_PREFIX = "oklaw";

export const AUTH_OPTIONS = {
  appName: "OKLaw",

  ...SCHEMA_MAPPING,

  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    /**
     * Longer than Better Auth's default of 8. Short passwords are the ones
     * that get reused, and this system holds privileged material — but the
     * length is also the *only* rule imposed. Composition requirements
     * ("one capital, one symbol") produce `Password1!` and are worse than a
     * length floor, which is why NIST stopped recommending them.
     */
    minPasswordLength: 12,
    /**
     * No email provider exists in this stack yet (Phase 7 owns communications),
     * so verification cannot be required — requiring what cannot be delivered
     * would lock every account out.
     */
    requireEmailVerification: false,
  },

  session: {
    ...SCHEMA_MAPPING.session,
    expiresIn: SESSION_LIFETIME_DAYS * 24 * 60 * 60,
    /**
     * A session in continuous use is extended at most once a day rather than
     * on every request, which keeps `sessions` from taking a write per page
     * view. The cost is that the expiry a row shows can be up to a day behind
     * what the user would experience.
     */
    updateAge: SESSION_REFRESH_DAYS * 24 * 60 * 60,
  },

  advanced: {
    cookiePrefix: COOKIE_PREFIX,
    database: {
      /**
       * ids are UUIDs, because `UserId` in the domain is a branded UUID and
       * every other id in this system is one. Better Auth's default is a
       * 32-character random string, which would decode-fail at the boundary of
       * every service that takes a `UserId` — and the failure would arrive on
       * first sign-in, not at startup.
       */
      generateId: () => crypto.randomUUID(),
    },
  },
} as const satisfies BetterAuthOptions;
