import { createLocalAccountIssuer } from "@better-auth/core/db";
import { Effect } from "effect";
import { Auth } from "./auth";

/**
 * Writing the credential Better Auth will check on sign-in.
 *
 * Here rather than in `seed/logins.ts`, where it started, because two callers
 * now need it and only one of them is the demonstration: the seed gives six
 * fixtures a shared published password, and `provision/admin.ts` gives one real
 * person a password they chose. The operation is identical and the reasons for
 * its awkward parts are identical, so there is one copy of both.
 *
 * ## Why this is not `auth.api.signUpEmail`
 *
 * Sign-up is disabled (`options.ts`), and it would be the wrong shape even if
 * it were not: a login here must point at an existing `advocates` or `clients`
 * row, and the sign-up endpoint knows nothing about either. So the `users` row
 * is written through `UserRepository` — which takes the subject as a tagged
 * value and cannot produce an unlinked login — and Better Auth is asked only
 * for the one thing it is here for: the password hash, and the `accounts` row
 * that holds it.
 *
 * `$context` is the library's own internals, and reaching into them is a real
 * cost worth naming: it is a surface with no compatibility promise, and a minor
 * upgrade could move it. The alternative is hashing passwords in this
 * repository, which ADR 0004 rejected for good reasons that have not changed.
 * Of the two, borrowing the library's hasher is the one whose failure mode is a
 * loud break at build time.
 *
 * ## One password per person, and only because of who calls this
 *
 * `createAccount` appends. Two calls for the same user are two `accounts` rows,
 * which is two passwords that both work and only one of which anybody ever
 * changes.
 *
 * Nothing here prevents that, and it is worth being precise about why it is
 * safe. The seed wipes `users` first and `accounts` cascades, so it cannot
 * happen there. `provisionAdmin` refuses an email that already has a login
 * before it reaches this, so it cannot happen there either. A third caller
 * would have to make the same argument for itself — this function is not the
 * place the guarantee lives, and reading it as one would be a mistake.
 */
export const setPassword = (id: string, password: string) =>
  Effect.gen(function* () {
    const auth = yield* Auth;
    const context = yield* Effect.promise(() => auth.$context);
    const hash = yield* Effect.promise(() => context.password.hash(password));

    yield* Effect.promise(() =>
      context.internalAdapter.createAccount({
        userId: id,
        accountId: id,
        providerId: "credential",
        /**
         * `local:credential`, computed rather than written out.
         *
         * The value is Better Auth's own namespacing — it is what keeps an
         * OAuth provider that happens to be called "credential" from colliding
         * with a password — and it is half of the unique index the library
         * looks a password up by. Hardcoding the string would work until the
         * format changed, and the symptom would be a password that saves and
         * never matches.
         */
        issuer: createLocalAccountIssuer("credential"),
        password: hash,
      }),
    );
  });
