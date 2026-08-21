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
  "time:read",
  "time:write",
  "hearing:read",
  "hearing:write",
  "document:read",
  "document:write",
  "task:read",
  "task:write",
  "message:read",
  "message:write",
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
 * `trust:write` is now held, and by exactly two roles. It was granted to nobody
 * for as long as nothing could move client money — a permission with no
 * operation behind it is a claim the system does not honour — and Phase 7 gave
 * it two: receiving a deposit, and settling a fee note out of what is held.
 *
 * A Finance Officer holds it because moving money is the job. A Managing
 * Partner holds it because under the Advocates (Accounts) Rules the money is
 * the *advocate's* responsibility and somebody with a practising certificate
 * has to be able to act on it. An ordinary Advocate does not, which is the
 * entry worth arguing with: it is a deliberate separation of duties, not an
 * oversight, and the effect is that no single fee-earner can both raise a fee
 * note and pay it out of their own client's money.
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
  "Managing Partner": [...PERMISSIONS],
  Advocate: [
    "case:read",
    "case:open",
    "case:amend",
    "case:transition",
    "client:read",
    "client:write",
    "invoice:read",
    "trust:read",
    "time:read",
    "time:write",
    "hearing:read",
    "hearing:write",
    "document:read",
    "document:write",
    "task:read",
    "task:write",
    "message:read",
    "message:write",
    "staff:read",
  ],
  "Legal Assistant": [
    "case:read",
    "case:amend",
    "case:transition",
    "client:read",
    "invoice:read",
    "time:read",
    "time:write",
    "hearing:read",
    "hearing:write",
    "document:read",
    "document:write",
    "task:read",
    "task:write",
    "message:read",
    "message:write",
    "staff:read",
  ],
  "Finance Officer": [
    "case:read",
    "client:read",
    "invoice:read",
    "invoice:write",
    "trust:read",
    "trust:write",
    /**
     * Read, and not write. A fee note is built from recorded time, so finance
     * has to see it; recording it is the fee-earner's act and nobody else's.
     * Time somebody else entered on your behalf is not a record of your work.
     */
    "time:read",
    /**
     * Finance holds both halves, unlike time.
     *
     * The asymmetry is deliberate and it is about who *does* the thing.
     * Recording time is the fee-earner's own act, so finance reads it and does
     * not write it. Reconciling the trust account is finance's own work — it is
     * the prototype's one task with no matter behind it — and a system where
     * the person who has to do a job cannot write it down is a system people
     * keep a second list beside.
     */
    "task:read",
    "task:write",
    /**
     * Finance corresponds with clients about money — a fee note query is the
     * commonest message a firm receives — so they hold both halves.
     */
    "message:read",
    "message:write",
    "staff:read",
  ],
  /**
   * A Receptionist reads the court diary and does not write it.
   *
   * They answer the telephone to a client asking when their matter is next in
   * court, so withholding the diary would make the job impossible. Listing a
   * matter is an advocate's act — it follows from what the court directed, not
   * from what somebody was told on the phone.
   */
  /**
   * A Receptionist reads work and does not raise it, for the same reason they
   * read the diary and do not list a matter: chasing a client for documents is
   * a task somebody assigned, and the front desk carrying it out is not the
   * same as the front desk deciding it needs doing.
   */
  Receptionist: [
    "case:read",
    "client:read",
    "hearing:read",
    "task:read",
    /**
     * The front desk reads correspondence and does not write it. They answer
     * the telephone to a client who says "I emailed last week" and need to see
     * whether that is so; replying on the firm's behalf about a matter is an
     * advocate's act, and a message from the firm is attributed to whoever
     * sent it.
     */
    "message:read",
    "staff:read",
  ],
};

/**
 * What a signed-in client may do: read four things about themselves, and write
 * exactly one.
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
  /**
   * Added in Phase 7, and the one genuinely new *grant* a portal user has ever
   * received.
   *
   * A client is entitled to the documents on their own file — that is what the
   * portal is for. The scope is what keeps them to their own: `withinScope`
   * answers `NotFound` for a document on somebody else's matter, exactly as it
   * does for the matter itself.
   *
   * `document:write` is deliberately not here. A client uploading to their own
   * matter file is a reasonable feature and a different one: it needs a
   * quarantine, a review step and a decision about what happens to a document
   * the firm did not put there. Granting the verb before any of that exists
   * would be a claim the system does not honour.
   */
  "document:read",
  /**
   * **The portal's first and only write**, and the asymmetry with
   * `document:write` above is the whole argument for it.
   *
   * A client portal whose client cannot write is a notice board. Messaging is
   * the feature people mean when they say "portal", and refusing it would push
   * the conversation back onto email — which is unencrypted, unattributed, and
   * outside every guarantee this system makes.
   *
   * So why this and not a document upload? **A message needs no quarantine.**
   * It is text that lands in a thread the firm reads; it becomes part of the
   * correspondence record and nothing else acts on it. A document is different
   * in kind: it enters the matter *file*, it is what gets filed at court and
   * relied on, and a file that anybody may add to needs a review step and a
   * decision about what happens to a document the firm did not put there.
   *
   * The scope still does the real work. `message:write` lets a client add to
   * *their own* thread; `withinScope` is what makes "their own" true, and a
   * client cannot address a message to another client's thread any more than
   * they can read one.
   *
   * There is deliberately no delete. A message cannot be withdrawn by either
   * side — see `domain/message/message.ts` — and a portal user is not an
   * exception to a rule that binds the firm.
   */
  "message:read",
  "message:write",
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
 * What a role grants, without needing somebody who holds it.
 *
 * `permissionsOf` takes a principal because every *enforcement* site has one,
 * and asking "what may this person do" is the right question there. The
 * permissions screen asks a different one — "what does this role mean" — and
 * had to invent a fake principal to ask it, which is a cast around a type that
 * was telling the truth.
 *
 * Deliberately not defined for a portal user: their grants are not a row in
 * this table, and offering `permissionsForRole("Client Portal User")` would
 * imply they are. See `PORTAL` below.
 */
export const permissionsForRole = (role: Role): readonly Permission[] =>
  BY_ROLE[role];

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
