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
  /**
   * Money. Four actions rather than one `invoice.changed`, because these are
   * the entries somebody will actually be looking for.
   *
   * `invoice.settled` is separate from `invoice.paid` although both end in a
   * payment row, and the distinction is the one an auditor cares about: a
   * payment recorded from outside is the client sending money, while a
   * settlement is the *firm* moving money it already held on trust into its own
   * account. The second is a transfer under Rule 9 and the first is not, and a
   * trail that called them the same thing could not answer which withdrawals
   * from client account were made and why — which is the question the Advocates
   * (Accounts) Rules exist to make answerable.
   */
  "invoice.raised",
  "invoice.paid",
  "invoice.settled",
  "trust.deposited",
  "time.recorded",
  "time.amended",
  "client.opened",
  "client.amended",
  /**
   * The one **read** in this system that is audited, and the exception needs
   * its reason stated because the paragraph above says reads are not.
   *
   * A conflict screen is not a page view. It is a professional act performed
   * before a retainer is accepted, and "was a conflict check run, when, and
   * what did it show" is a question the Law Society asks after the fact. An
   * unrecorded screen is indistinguishable from one that never happened.
   *
   * The findings go in the snapshot, so the entry says what the advocate was
   * looking at when they decided — not merely that they looked.
   */
  "client.screened",
  "hearing.scheduled",
  "hearing.recorded",
  "document.uploaded",
  "document.revised",
  "document.filed",
  /**
   * Work, and specifically the two entries that answer for it.
   *
   * `task.completed` and `task.reopened` are both here because the domain
   * *discards* a completion record when a task is reopened — a task is a note
   * to ourselves about work rather than evidence about the world, so it does
   * not get the append-only treatment a document or a hearing outcome gets.
   * The trail is therefore the only place the reversal survives, which is why
   * both halves are recorded rather than just the reopening.
   *
   * `task.reassigned` is separate from a general amendment because "who was
   * this given to, and when did that change" is the question asked when a
   * deadline is missed, and it should not require reading a diff.
   */
  "task.raised",
  "task.reassigned",
  "task.completed",
  "task.reopened",
  /**
   * Correspondence, and only the sending of it.
   *
   * There is no `message.read`. Reads are not audited — a row per page view
   * buries the entries that matter — and a message being *seen* is already
   * recorded on the message itself, where a client can ask about it. Sending
   * is the act, and "what was said to this client and when" is the question
   * asked after a complaint.
   */
  "message.sent",
  /**
   * A note about a conversation the system never saw.
   *
   * Audited even though it is only a summary, because *when it was written* is
   * the part that matters: a note recorded three weeks after the call is a
   * different kind of evidence from one recorded the same afternoon, and the
   * trail's timestamp is what shows which.
   */
  "contact.logged",
  "session.signed-in",
  "session.signed-out",
  "session.refused",
  /**
   * A sign-in stopped before the password was even checked, because too many
   * had already been tried from that connection.
   *
   * Separate from `session.refused`, and the distinction is what an incident
   * review turns on. A run of `session.refused` is somebody who has forgotten
   * their password, or somebody guessing and getting nowhere. A
   * `session.throttled` is the control *firing* — the point at which guessing
   * stopped being possible — and a trail that recorded both as "refused" could
   * not say whether the limiter had done anything.
   */
  "session.throttled",
] as const;

export const AuditAction = Schema.Literal(...AUDIT_ACTIONS);
export type AuditAction = typeof AuditAction.Type;

/** What kind of thing was acted on. */
export const AUDITED_ENTITIES = [
  "case",
  "client",
  "invoice",
  "trust",
  "time",
  "hearing",
  "document",
  "task",
  "message",
  "contact",
  "user",
] as const;

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
    case "invoice.raised":
      return "Raised a fee note";
    case "invoice.paid":
      return "Recorded a payment";
    case "invoice.settled":
      return "Settled a fee note from client money";
    case "trust.deposited":
      return "Received client money into the trust account";
    case "time.recorded":
      return "Recorded time on a matter";
    case "time.amended":
      return "Corrected a time entry";
    case "client.opened":
      return "Took on a client";
    case "client.amended":
      return "Corrected a client's particulars";
    case "client.screened":
      return "Ran a conflict-of-interest screen";
    case "hearing.scheduled":
      return "Listed a matter for hearing";
    case "hearing.recorded":
      return "Recorded how a hearing went";
    case "document.uploaded":
      return "Put a document on a matter file";
    case "document.revised":
      return "Added a version to a document";
    case "task.raised":
      return "Raised a task";
    case "task.reassigned":
      return "Reassigned a task";
    case "task.completed":
      return "Completed a task";
    case "task.reopened":
      return "Reopened a completed task";
    case "message.sent":
      return "Sent a message to a client";
    case "contact.logged":
      return "Logged a conversation with a client";
    case "document.filed":
      return "Marked a document as filed with the court";
    case "session.signed-in":
      return "Signed in";
    case "session.signed-out":
      return "Signed out";
    case "session.refused":
      return "Sign-in refused";
    case "session.throttled":
      return "Sign-in stopped: too many attempts from one connection";
  }
};
