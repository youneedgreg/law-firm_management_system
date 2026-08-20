import { Context, Effect, Schema } from "effect";
import type { Permission } from "../domain/identity/permissions";
import { authorize, type NotPermitted } from "../domain/identity/permissions";
import type { Principal, Scope } from "../domain/identity/principal";
import { includes, scopeOf } from "../domain/identity/principal";
import type { ClientId } from "../domain/shared/ids";
import { NotFound } from "./repositories";

/**
 * Authorization, as a requirement in the type.
 *
 * `CurrentUser` is a `Context.Tag`, so an operation that checks it has
 * `CurrentUser` in its `R` channel and *cannot be run without one being
 * provided*. That is the property this whole file exists for: forgetting the
 * authorization check is not a code review question here, it is a compile
 * error at the call site, because the effect will not run until somebody says
 * who is asking.
 *
 * Compare the usual arrangement — a `getCurrentUser()` that reads a request
 * local and returns `User | null`. Every caller can ignore it, nothing marks
 * the ones that did, and the one place it was forgotten is discovered by
 * whoever finds their data in somebody else's account.
 */
export class CurrentUser extends Context.Tag("oklaw/CurrentUser")<
  CurrentUser,
  Principal
>() {}

/**
 * Nobody is signed in.
 *
 * Distinct from `NotPermitted` because the answers differ: this one is
 * remedied by signing in and the other never is, which is the difference
 * between a 401 and a 403 and between a redirect and a message.
 */
export class NotAuthenticated extends Schema.TaggedError<NotAuthenticated>()(
  "NotAuthenticated",
  {},
) {
  get reason(): string {
    return "Sign in to continue";
  }
}

/**
 * Requires a permission, and hands back who holds it.
 *
 * Returning the principal rather than `void` is what keeps the next line from
 * reaching for `CurrentUser` a second time: the operations that check a
 * permission almost always need the person too, to scope a query or to record
 * an audit entry.
 */
export const permitted = (
  permission: Permission,
): Effect.Effect<Principal, NotPermitted, CurrentUser> =>
  Effect.flatMap(CurrentUser, (principal) => authorize(principal, permission));

/** The rows this principal may see at all. */
export const scope: Effect.Effect<Scope, never, CurrentUser> = Effect.map(
  CurrentUser,
  scopeOf,
);

/**
 * Refuses a record outside the caller's scope — as **absence**, not as denial.
 *
 * This is the most deliberate decision in the file, and it looks like a bug
 * until the reason is stated: a portal user who asks for another client's
 * matter gets `NotFound`, the same answer they would get for a matter that does
 * not exist.
 *
 * A truthful "you are not allowed to see this matter" is an oracle. It confirms
 * the record exists, and with it the client, the reference, and the fact that
 * the firm acts for them — which for a law firm is itself confidential. Whether
 * a person is a client of a divorce practice is not a detail that should be
 * derivable from the difference between two status codes.
 *
 * Staff are a different case and are treated differently: a Receptionist
 * refused the trust ledger gets `NotPermitted`, because everyone at the firm
 * already knows the ledger exists and hiding it would only make the system
 * confusing. Scope conceals; permission explains.
 */
export const withinScope = (
  entity: string,
  id: string,
  owner: ClientId,
): Effect.Effect<void, NotFound, CurrentUser> =>
  Effect.flatMap(scope, (visible) =>
    includes(visible, owner)
      ? Effect.void
      : Effect.fail(new NotFound({ entity, id })),
  );
