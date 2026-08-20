import { Either, Schema } from "effect";
import type { Role } from "../firm/advocate";
import type { Principal } from "./principal";

/**
 * What each role may do, as data.
 *
 * Two things this deliberately is not:
 *
 * 1. **Not a set of booleans on the user.** `canEditCases` on a row is a
 *    permission that has to be granted correctly on every insert, and drifts
 *    the moment two administrators disagree. A role is granted once; the
 *    permissions follow from the table below.
 * 2. **Not a check in a component.** `{role === "Finance Officer" && <Button/>}`
 *    hides the button and leaves the endpoint open, which is the whole of the
 *    difference between a UI affordance and an authorization control. The UI
 *    may read this table to decide what to show — `services/policy.ts` is what
 *    decides what happens.
 *
 * The permission strings are `subject:verb`, and the union is closed: a typo is
 * a compile error rather than a check that silently never passes. That is worth
 * more than it sounds, because the failure mode of a misspelled permission in a
 * string-keyed system is *permissive* if the code reads "deny only what is
 * listed" and *invisible* if it reads "allow only what is listed".
 */

export const PERMISSIONS = [
  "case:read",
  "case:open",
  "case:amend",
  "case:transition",
  "client:read",
  "client:write",
  "invoice:read",
  "invoice:write",
  "trust:read",
  "trust:write",
  "staff:read",
  "audit:read",
] as const;

export const Permission = Schema.Literal(...PERMISSIONS);
export type Permission = typeof Permission.Type;

/**
 * The grants, by role.
 *
 * Read down the columns rather than across: the interesting entries are the
 * *absences*. A Receptionist may see the caseload and the client list because
 * they answer the telephone to both, and may see no money at all. A Finance
 * Officer is the mirror image — the fee notes and the client account, and no
 * power to move a matter through its lifecycle. A Legal Assistant does the work
 * on a matter and cannot open one, because intake runs a conflict check that is
 * an advocate's professional responsibility.
 *
 * Nobody has `trust:write`. Client money moves only by settling a fee note,
 * which is `InvoiceRepository.settleFromTrust` and is Phase 7's write path; a
 * permission granted before there is an operation behind it is a claim the
 * system does not honour.
 */
const BY_ROLE: Readonly<Record<Role, readonly Permission[]>> = {
  /**
   * Deliberately not "everything". An administrator manages logins and reads
   * the audit trail; they are not given the power to move client money or file
   * in court, because in a real firm they are not an advocate. The temptation
   * to make this role a superuser is exactly how an administrator account
   * becomes the most valuable thing an attacker can take.
   */
  "System Administrator": [
    "case:read",
    "client:read",
    "staff:read",
    "audit:read",
  ],
  "Managing Partner": [...PERMISSIONS].filter(
    (permission) => permission !== "trust:write",
  ),
  Advocate: [
    "case:read",
    "case:open",
    "case:amend",
    "case:transition",
    "client:read",
    "client:write",
    "invoice:read",
    "trust:read",
    "staff:read",
  ],
  "Legal Assistant": [
    "case:read",
    "case:amend",
    "case:transition",
    "client:read",
    "invoice:read",
    "staff:read",
  ],
  "Finance Officer": [
    "case:read",
    "client:read",
    "invoice:read",
    "invoice:write",
    "trust:read",
    "staff:read",
  ],
  Receptionist: ["case:read", "client:read", "staff:read"],
};

/**
 * What a signed-in client may do, which is read three things about themselves.
 *
 * A separate list rather than a seventh row in the table above, for the same
 * reason `PortalUser` is a separate variant: a portal user's permissions are
 * not a weaker version of a staff member's. They are the same verbs against a
 * different scope, and *the scope is what does the work here* — `case:read`
 * grants a portal user nothing on its own, because every read is also filtered
 * through `Scope` (see `principal.ts`). Permission says which verbs; scope says
 * over which rows. Both are required, and confusing the two is how "the query
 * forgot the `WHERE`" becomes a breach.
 */
const PORTAL: readonly Permission[] = [
  "case:read",
  "client:read",
  "invoice:read",
];

/** Whether this principal holds this permission at all, before any row is seen. */
export const may = (principal: Principal, permission: Permission): boolean =>
  principal._tag === "Staff"
    ? BY_ROLE[principal.role].includes(permission)
    : PORTAL.includes(permission);

/** Every permission a principal holds — for the UI, which decides what to offer. */
export const permissionsOf = (principal: Principal): readonly Permission[] =>
  principal._tag === "Staff" ? BY_ROLE[principal.role] : PORTAL;

/**
 * A refusal that names the rule it applied.
 *
 * Consistent with every other refusal in this codebase: the error carries the
 * specifics — who, and which permission — and composes the sentence itself,
 * rather than the caller inventing one. This one is deliberately vague about
 * *why* the permission is not held, because a refusal that explains the
 * permission table to whoever tripped it is a refusal that documents the
 * system's soft spots to an attacker.
 */
export class NotPermitted extends Schema.TaggedError<NotPermitted>()(
  "NotPermitted",
  {
    role: Schema.String,
    permission: Permission,
  },
) {
  get reason(): string {
    return `A ${this.role} may not ${this.permission.replace(":", " ")}`;
  }
}

/** `may`, as a value that carries the refusal. */
export const authorize = (
  principal: Principal,
  permission: Permission,
): Either.Either<Principal, NotPermitted> =>
  may(principal, permission)
    ? Either.right(principal)
    : Either.left(
        new NotPermitted({
          role:
            principal._tag === "Staff" ? principal.role : "Client Portal User",
          permission,
        }),
      );
