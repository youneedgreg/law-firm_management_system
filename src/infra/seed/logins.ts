import { createLocalAccountIssuer } from "@better-auth/core/db";
import { Effect, Schema } from "effect";
import type * as Client from "../../domain/client/client";
import type * as Firm from "../../domain/firm/advocate";
import { UserId } from "../../domain/shared/ids";
import { DEMO_PASSWORD } from "../../lib/demo";
import { UserRepository } from "../../services/repositories";
import { Auth } from "../auth/auth";
import { stableId } from "./ids";

/**
 * Logins for the demo (D-5).
 *
 * One per member of staff, plus one client so that the portal has somebody to
 * be. Every account shares a password, which is written down on the sign-in
 * page — this is a portfolio deployment holding fixtures for a firm that does
 * not exist, and a reviewer who has to ask for credentials is a reviewer who
 * has already closed the tab. It would be indefensible anywhere else, which is
 * why it is stated in three places rather than left to be discovered.
 *
 * ## Why this is not `auth.api.signUpEmail`
 *
 * Sign-up is disabled (`options.ts`), and it would be the wrong shape even if
 * it were not: a login here must point at an existing `advocates` or `clients`
 * row, and the sign-up endpoint knows nothing about either. So the row is
 * written through `UserRepository` — which takes the subject as a tagged value
 * and cannot produce an unlinked login — and Better Auth is asked only for the
 * one thing it is here for: the password hash, and the `accounts` row that
 * holds it.
 *
 * `$context` is the library's own internals, and reaching into them is a real
 * cost worth naming: it is a surface with no compatibility promise, and a minor
 * upgrade could move it. The alternative is hashing passwords in this
 * repository, which ADR 0004 rejected for good reasons that have not changed.
 * Of the two, borrowing the library's hasher is the one whose failure mode is a
 * loud break at build time.
 */

const userId = (key: string) =>
  Schema.decodeSync(UserId)(stableId("user", key));

/**
 * Writes the credential Better Auth will check on sign-in.
 *
 * `provider_id = 'credential'` is the library's name for an email-and-password
 * account, as opposed to a social one. A second seed run does not produce a
 * second row: the wipe deletes `users` first and `accounts` cascades from it,
 * so there is never more than one password per person — two rows would mean two
 * passwords that both work, and only one of them ever changed.
 */
const setPassword = (id: string, password: string) =>
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
         * OAuth provider that happens to be called "credential" from
         * colliding with a password — and it is half of the unique index the
         * library looks a password up by. Hardcoding the string would work
         * until the format changed, and the symptom would be a password that
         * saves and never matches.
         */
        issuer: createLocalAccountIssuer("credential"),
        password: hash,
      }),
    );
  });

export const provisionLogins = (
  staff: readonly Firm.Advocate[],
  clients: readonly Client.Client[],
  portalClientNumber: string,
) =>
  Effect.gen(function* () {
    const users = yield* UserRepository;

    yield* Effect.forEach(staff, (person) =>
      Effect.gen(function* () {
        const id = userId(person.email);
        yield* users.provision({
          id,
          name: person.name,
          email: person.email,
          subject: { _tag: "Staff", advocateId: person.id },
        });
        yield* setPassword(id, DEMO_PASSWORD);
      }),
    );

    /**
     * Exactly one client gets a portal login, and the point of the demo is what
     * happens when they ask for anything belonging to the other five.
     */
    const portalClient = clients.find(
      (client) => client.number === portalClientNumber,
    );

    if (portalClient === undefined) {
      return yield* Effect.fail(
        new Error(
          `Portal client ${portalClientNumber} is not among the seeded clients`,
        ),
      );
    }

    const id = userId(portalClient.email);
    yield* users.provision({
      id,
      name: portalClient.name,
      email: portalClient.email,
      subject: { _tag: "Client", clientId: portalClient.id },
    });
    yield* setPassword(id, DEMO_PASSWORD);

    return { staff: staff.length, portal: portalClient.email };
  });
