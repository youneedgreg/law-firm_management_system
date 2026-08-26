import { Effect, Layer, Option, Schema } from "effect";
import { Advocate } from "../../domain/firm/advocate";
import { AdvocateId, UserId } from "../../domain/shared/ids";
import {
  AdvocateRepository,
  UserRepository,
} from "../../services/repositories";
import { AuthLive } from "../auth/auth";
import { setPassword } from "../auth/credentials";
import { AUTH_OPTIONS } from "../auth/options";
import { AdvocateRepositoryLive } from "../sql/advocate-repository";
import { PgLive } from "../sql/client";
import { UserRepositoryLive } from "../sql/user-repository";
import type { AdminRequest } from "./options";

/**
 * The first login on a firm's installation (D-13).
 *
 * ## Why this program has to exist
 *
 * `disableSignUp: true` closes the sign-up endpoint permanently, and correctly
 * — a law firm does not have members of the public creating accounts. The
 * consequence was that the *only* code path in this repository that created a
 * user was the demonstration seed, which wipes twenty-three tables first and
 * now refuses to run outside the demo at all (D-11).
 *
 * So a freshly migrated database was one nobody could sign in to. Not a
 * difficult problem, but one that surfaces at the worst possible moment: after
 * Neon is provisioned, after the domain is pointed, in front of the client.
 *
 * ## What it will not do
 *
 * Two reads — is this address a login already, is it on the staff list already —
 * and three writes: the `advocates` row, the `users` row that points at it, and
 * the `accounts` row holding the password hash. It does not wipe, does not
 * migrate, does not seed, and has no code path that touches a table it is not
 * inserting into. That is deliberate and worth stating: the last program in
 * this repository that provisioned logins was a wipe-and-load, and the whole
 * reason this one exists separately is so that "create an account" and "empty
 * the database" are not two behaviours of one script.
 *
 * ## Refusing before writing
 *
 * Two checks, and they run before either insert:
 *
 * - **A login for this address.** `users.email` is `UNIQUE`, so the database
 *   would refuse the second one anyway — but it would refuse it *after* the
 *   advocate row was written, leaving a member of staff with no login and a
 *   half-finished operation for somebody to unpick by hand.
 * - **A staff record for this address.** `advocates.email` is deliberately
 *   *not* unique, so nothing else would catch this. Running the same command
 *   twice would quietly produce two people with one name, and the second one
 *   would be the one the login points at.
 *
 * There is no transaction around the pair. There could be — `TransactorLive`
 * exists — and it is not worth it here: this is a program a person runs and
 * reads the output of, the failure window is two statements wide, and the
 * refusals above mean a re-run after a failure says exactly what already
 * exists rather than duplicating it.
 */

/** What was created, for the operator to read back. */
export interface Provisioned {
  readonly userId: UserId;
  readonly advocateId: AdvocateId;
  readonly email: string;
  readonly role: string;
}

const uuid = <A, I>(schema: Schema.Schema<A, I>) =>
  Schema.decodeSync(schema as unknown as Schema.Schema<A, string>)(
    crypto.randomUUID(),
  );

/**
 * The password rule, taken from the auth options rather than restated.
 *
 * `minPasswordLength` is what Better Auth enforces when somebody *changes*
 * their password through the application. A provisioning script that accepted
 * a shorter one would be a back door around the only password rule this system
 * has — and the person it lets in is the Managing Partner.
 */
export const MINIMUM_PASSWORD = AUTH_OPTIONS.emailAndPassword.minPasswordLength;

export const provisionAdmin = (request: AdminRequest, password: string) =>
  Effect.gen(function* () {
    if (password.length < MINIMUM_PASSWORD) {
      return yield* Effect.fail(
        new Error(
          `The password must be at least ${MINIMUM_PASSWORD} characters. ` +
            "That is the same floor the application enforces; this program " +
            "does not get its own, lower one.",
        ),
      );
    }

    const advocates = yield* AdvocateRepository;
    const users = yield* UserRepository;

    const existing = yield* users.byEmail(request.email);

    if (Option.isSome(existing)) {
      return yield* Effect.fail(
        new Error(
          `${request.email} already has a login. This program creates ` +
            "accounts and never changes them — to reset a password, do it " +
            "through the application.",
        ),
      );
    }

    const staff = yield* advocates.all();
    const sameAddress = staff.find(
      (person) => person.email.toLowerCase() === request.email.toLowerCase(),
    );

    if (sameAddress !== undefined) {
      return yield* Effect.fail(
        new Error(
          `${request.email} is already ${sameAddress.name} on the firm's ` +
            "staff list, without a login. Nothing has been written; that " +
            "record needs a login rather than a second staff record.",
        ),
      );
    }

    /**
     * Decoded through `Advocate` rather than assembled as an object literal.
     *
     * The repository would take either, and the schema is what turns a name of
     * spaces or a certificate year of 1899 into a refusal here rather than a
     * `CHECK` violation three lines later. The domain and the DDL carry the
     * same rules on purpose; this is where a script gets the benefit of it.
     */
    const advocate = yield* Schema.decodeUnknown(Advocate)({
      id: uuid(AdvocateId),
      name: request.name,
      role: request.role,
      email: request.email,
      active: true,
      ...(request.certificate === undefined
        ? {}
        : { practisingCertificate: request.certificate }),
    });

    yield* Effect.logInfo(`Creating ${advocate.name} (${advocate.role})…`);
    yield* advocates.save(advocate);

    const userId = uuid(UserId);

    yield* users.provision({
      id: userId,
      name: advocate.name,
      email: advocate.email,
      subject: { _tag: "Staff", advocateId: advocate.id },
    });

    yield* setPassword(userId, password);

    yield* Effect.logInfo(`${advocate.email} can now sign in.`);

    return {
      userId,
      advocateId: advocate.id,
      email: advocate.email,
      role: advocate.role,
    } satisfies Provisioned;
  });

/**
 * Only what this program touches.
 *
 * Deliberately not `AppLayer` and deliberately not `SeedLayer`. The first
 * carries every service in the application, and a script that empties nothing
 * has no business holding a `TrustRepository`. The second carries the seed's
 * blob store and its fixtures. What is needed here is two repositories and the
 * password hasher, and a layer that lists exactly that is a layer a reader can
 * check against the two inserts above.
 */
export const ProvisionLayer = Layer.mergeAll(
  AdvocateRepositoryLive,
  UserRepositoryLive,
).pipe(Layer.provideMerge(PgLive), Layer.merge(AuthLive));
