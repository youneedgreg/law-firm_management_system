import { Option, Schema } from "effect";
import { AuditEntryId, UserId } from "../shared/ids";
import type { Principal } from "../identity/principal";
import { roleLabel } from "../identity/principal";

/**
 * The audit trail: who did what, to which record, when, and what changed.
 *
 * ## Why the actor is copied rather than joined
 *
 * `actor` holds the user's id *and* their name and role as they were at the
 * time. A join to `users` would be smaller and would be wrong: staff leave,
 * people marry and change their name, and roles get reassigned. An entry that
 * reads "Sarah Kimani (Advocate) closed this matter" must go on saying that
 * after Sarah becomes a partner, because the record is a statement about the
 * past. Denormalising here is not a shortcut around a join — it is the point.
 *
 * The same reasoning is why `before` and `after` are snapshots rather than a
 * pointer at the row: the row will change again.
 */

/**
 * The actions worth recording, as a closed union.
 *
 * Every one of them is a *write*, plus the two session events — because "who
 * was logged in at 02:40" is the first question asked when something is found
 * to be wrong, and it is unanswerable from mutations alone.
 *
 * Reads are not audited. That is a real decision with a real cost: this trail
 * cannot answer "who looked at this client's file". Auditing reads means a row
 * per page view, which at this scale would bury the twelve entries that matter
 * under a hundred thousand that do not. If confidential-access logging is ever
 * needed it belongs in its own table with its own retention, not here.
 */
export const AUDIT_ACTIONS = [
  "case.opened",
  "case.amended",
  "case.transitioned",
  "session.signed-in",
  "session.signed-out",
  "session.refused",
] as const;

export const AuditAction = Schema.Literal(...AUDIT_ACTIONS);
export type AuditAction = typeof AuditAction.Type;

/** What kind of thing was acted on. */
export const AUDITED_ENTITIES = ["case", "client", "invoice", "user"] as const;

export const AuditedEntity = Schema.Literal(...AUDITED_ENTITIES);
export type AuditedEntity = typeof AuditedEntity.Type;

/**
 * Whoever did it, as they were at the time.
 *
 * `userId` is nullable-by-absence rather than nullable: a refused sign-in has
 * an email address and no user behind it, and recording it as a user id of
 * "unknown" would make a failed login look like an action by somebody.
 */
export const Actor = Schema.Struct({
  userId: Schema.Option(UserId),
  name: Schema.String,
  role: Schema.String,
});

export type Actor = typeof Actor.Type;

export const actorOf = (principal: Principal): Actor =>
  Actor.make({
    userId: Option.some(principal.userId),
    name: principal.name,
    role: roleLabel(principal),
  });

/**
 * An anonymous actor, for the events that happen before anyone is signed in.
 *
 * A refused sign-in is the one audited event with no principal behind it, and
 * it is also the one a reviewer looks for first. The email typed is the only
 * identifying thing there is, and it goes in `name` because that is what it is:
 * a claim about who this was, not an established identity.
 */
export const attemptedBy = (email: string): Actor =>
  Actor.make({ userId: Option.none(), name: email, role: "Not signed in" });

/**
 * A record as it stood, flattened to primitives.
 *
 * `Unknown` rather than a union of the entity schemas, and the reason is
 * retention: an audit entry outlives the shape of the thing it describes. When
 * `Case` gains a field in Phase 7, ten thousand rows written before then still
 * have to decode, and a schema that names today's fields would refuse them.
 * What is stored is what the entity encoded to at the time, which is exactly
 * the guarantee wanted — a faithful copy of what was written, not a
 * reinterpretation of it through a later model.
 */
export const Snapshot = Schema.Record({
  key: Schema.String,
  value: Schema.Unknown,
});

export type Snapshot = typeof Snapshot.Type;

/**
 * An entity, flattened to what will actually be stored.
 *
 * A JSON round trip, which looks lazy and is deliberate. The column is `jsonb`,
 * so this is precisely the transformation Postgres would apply on the way in —
 * doing it here means the snapshot compared by `changes` is the snapshot that
 * was stored, rather than a richer in-memory value that differs from it in ways
 * nobody sees until a diff shows a change that did not happen. Dates become
 * ISO-8601 strings, absent fields disappear rather than becoming nulls, and
 * branded values lose only their brand, which never survived storage anyway.
 */
export const snapshotOf = (entity: object): Snapshot =>
  JSON.parse(JSON.stringify(entity)) as Snapshot;

export const AuditEntry = Schema.Struct({
  id: AuditEntryId,
  at: Schema.DateFromSelf,
  actor: Actor,
  action: AuditAction,
  entity: AuditedEntity,
  /** Absent for the session events, which act on no record. */
  entityId: Schema.Option(Schema.String),
  /** Absent when the record did not exist before — an intake, a sign-in. */
  before: Schema.Option(Snapshot),
  /** Absent when nothing survives the action, and for the session events. */
  after: Schema.Option(Snapshot),
});

export type AuditEntry = typeof AuditEntry.Type;

/**
 * The fields that actually changed.
 *
 * The compliance screen shows this rather than two JSON blobs side by side. An
 * amendment usually touches one field out of fifteen, and a reviewer scanning
 * for the one that moved should not have to diff by eye.
 *
 * Compared by JSON encoding rather than by `===`, because the values are
 * decoded snapshots and two structurally identical objects are not the same
 * reference. Field order within an object is stable here — both sides came from
 * the same encoder — so this does not report a change where there is none.
 */
export const changes = (
  entry: AuditEntry,
): readonly {
  readonly field: string;
  readonly from: string;
  readonly to: string;
}[] => {
  const before = Option.getOrElse(entry.before, (): Snapshot => ({}));
  const after = Option.getOrElse(entry.after, (): Snapshot => ({}));
  const fields = new Set([...Object.keys(before), ...Object.keys(after)]);

  return [...fields]
    .map((field) => ({
      field,
      from: render(before[field]),
      to: render(after[field]),
    }))
    .filter(({ from, to }) => from !== to)
    .sort((a, b) => a.field.localeCompare(b.field));
};

const render = (value: unknown): string => {
  if (value === undefined) return "—";
  if (value === null) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
};

/** A sentence for the compliance screen, composed from the entry itself. */
export const describe = (entry: AuditEntry): string => {
  switch (entry.action) {
    case "case.opened":
      return "Opened a matter";
    case "case.amended":
      return "Amended a matter";
    case "case.transitioned":
      return "Moved a matter through the lifecycle";
    case "session.signed-in":
      return "Signed in";
    case "session.signed-out":
      return "Signed out";
    case "session.refused":
      return "Sign-in refused";
  }
};
