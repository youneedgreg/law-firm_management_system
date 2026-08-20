import { Schema } from "effect";
import { Role } from "../firm/advocate";
import { AdvocateId, ClientId, UserId } from "../shared/ids";

/**
 * Who is making a request.
 *
 * A tagged union, and this is the single most load-bearing decision in Phase 6.
 * The obvious shape is one record with a `role` and two nullable links —
 * `advocateId` for staff, `clientId` for portal users — and it is wrong in a
 * way that only shows up as a data breach: nothing in that shape stops a row
 * with a staff role *and* a client link, and the code that decides what a
 * request may see would then have to pick which field to believe.
 *
 * Here, a `PortalUser` has no role at all and a `Staff` has no client. There is
 * no expressible value that is both, so no authorization check can be written
 * against the wrong one of the two. The database carries the same constraint —
 * `users_exactly_one_subject` in migration 0005 — because a schema this rests on
 * should not be enforceable only from TypeScript.
 *
 * ## The seventh role
 *
 * The specification names seven roles; `ROLES` in `domain/firm/advocate.ts`
 * lists six. The seventh, "Client Portal User", is this file's `PortalUser`
 * variant rather than a member of that union — precisely so that it cannot be
 * assigned to a member of staff, and so that the questions a portal user's
 * request has to answer ("which client is this, and is that matter theirs?")
 * are asked of a value that always carries a `clientId`.
 */

/**
 * Somebody who works at the firm.
 *
 * Carries the `AdvocateId` rather than the whole staff record: a principal is
 * built on every request, and a request that only needs to know "may this
 * person open a matter" should not force a second query. Where the record
 * itself is needed — a filing, which needs the practising certificate —
 * `CaseService` fetches it, and that read is the point at which a stale
 * certificate would be caught anyway.
 */
export const Staff = Schema.TaggedStruct("Staff", {
  userId: UserId,
  advocateId: AdvocateId,
  name: Schema.NonEmptyTrimmedString,
  email: Schema.String.pipe(Schema.pattern(/^[^@\s]+@[^@\s]+$/)),
  role: Role,
});

export type Staff = typeof Staff.Type;

/** A client, signed in to the portal, seeing their own matters and no others. */
export const PortalUser = Schema.TaggedStruct("PortalUser", {
  userId: UserId,
  clientId: ClientId,
  name: Schema.NonEmptyTrimmedString,
  email: Schema.String.pipe(Schema.pattern(/^[^@\s]+@[^@\s]+$/)),
});

export type PortalUser = typeof PortalUser.Type;

export const Principal = Schema.Union(Staff, PortalUser);
export type Principal = typeof Principal.Type;

/**
 * How much of the firm's data a principal may see, as a value.
 *
 * The alternative — every read taking a `Principal` and re-deriving this — is
 * how a system ends up with one query that filters by client and one that
 * forgot to. A `Scope` is small enough to pass into a repository and be part of
 * the *query*, so the rows a portal user may not see are never fetched in the
 * first place rather than fetched and then filtered.
 */
export const WholeFirm = Schema.TaggedStruct("WholeFirm", {});
export const OneClient = Schema.TaggedStruct("OneClient", {
  clientId: ClientId,
});

export const Scope = Schema.Union(WholeFirm, OneClient);
export type Scope = typeof Scope.Type;

export const scopeOf = (principal: Principal): Scope =>
  principal._tag === "Staff"
    ? WholeFirm.make({})
    : OneClient.make({ clientId: principal.clientId });

/**
 * Whether a record belonging to `clientId` is inside a scope.
 *
 * Takes the client id rather than the record, so the same check covers a
 * matter, an invoice, a document and a hearing without this module needing to
 * know what any of them look like. Every one of them belongs to exactly one
 * client, which is the property the portal's isolation rests on.
 */
export const includes = (scope: Scope, clientId: ClientId): boolean =>
  scope._tag === "WholeFirm" || scope.clientId === clientId;

/** The name to show for whoever is signed in. */
export const displayName = (principal: Principal): string => principal.name;

/**
 * What to call the principal's role in a sentence.
 *
 * Portal users have no `Role`, so this is a string and not a `Role` — the point
 * of the union is that the code cannot pretend otherwise.
 */
export const roleLabel = (principal: Principal): string =>
  principal._tag === "Staff" ? principal.role : "Client Portal User";
