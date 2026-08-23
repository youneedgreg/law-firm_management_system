import { Effect, Schema } from "effect";
import type * as Client from "../../domain/client/client";
import type * as Firm from "../../domain/firm/advocate";
import { UserId } from "../../domain/shared/ids";
import { DEMO_PASSWORD } from "../../lib/demo";
import { UserRepository } from "../../services/repositories";
import { setPassword } from "../auth/credentials";
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
 * The credential itself is written by `setPassword` in `auth/credentials.ts`,
 * which moved there when `provision/admin.ts` needed the same operation for a
 * real person's chosen password. Its comment carries the reasoning about
 * Better Auth's internals that used to live here.
 */

const userId = (key: string) =>
  Schema.decodeSync(UserId)(stableId("user", key));

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
