import { DateTime, Effect, Option, Schema } from "effect";
import * as Audit from "../domain/audit/entry";
import type { NotPermitted } from "../domain/identity/permissions";
import { AuditEntryId } from "../domain/shared/ids";
import { CurrentUser, permitted } from "./policy";
import {
  AuditRepository,
  type RepositoryFailure,
  type NotFound,
} from "./repositories";

/**
 * Writing the audit trail, and reading it back.
 *
 * Two operations that look symmetrical and are not. Writing is something the
 * services do as part of doing something else, and it takes no permission at
 * all — an action anybody is allowed to perform is an action they are allowed
 * to have recorded, and a permission check on the write would mean the events
 * least likely to be audited are the ones done by whoever arranged not to be.
 *
 * Reading requires `audit:read`, which is held by a Managing Partner and a
 * System Administrator and by nobody else. The trail says who did what, which
 * makes it the most sensitive read in the application after the trust ledger.
 */

export interface Recording {
  readonly action: Audit.AuditAction;
  readonly entity: Audit.AuditedEntity;
  readonly entityId?: string | undefined;
  readonly before?: object | undefined;
  readonly after?: object | undefined;
}

const entryId = (): Audit.AuditEntry["id"] =>
  Schema.decodeSync(AuditEntryId)(crypto.randomUUID());

const optionalSnapshot = (
  value: object | undefined,
): Option.Option<Audit.Snapshot> =>
  value === undefined ? Option.none() : Option.some(Audit.snapshotOf(value));

export class AuditLog extends Effect.Service<AuditLog>()("AuditLog", {
  effect: Effect.gen(function* () {
    const entries = yield* AuditRepository;

    /**
     * Records something the signed-in principal did.
     *
     * Requires `CurrentUser`, which is the whole trick: an audited operation
     * cannot be run without a principal, so there is no path that performs a
     * mutation and records it as having been done by nobody.
     */
    const record = (
      recording: Recording,
    ): Effect.Effect<void, RepositoryFailure, CurrentUser> =>
      Effect.gen(function* () {
        const principal = yield* CurrentUser;
        const at = yield* DateTime.nowAsDate;

        yield* entries.record(
          Audit.AuditEntry.make({
            id: entryId(),
            at,
            actor: Audit.actorOf(principal),
            action: recording.action,
            entity: recording.entity,
            entityId: Option.fromNullable(recording.entityId),
            before: optionalSnapshot(recording.before),
            after: optionalSnapshot(recording.after),
          }),
        );
      });

    /**
     * Records an event with no principal behind it — a refused sign-in, and the
     * successful one that creates the session in the first place.
     *
     * Kept as a separate operation rather than making `CurrentUser` optional on
     * the one above. An optional principal would make every audited mutation
     * silently recordable as anonymous, which is exactly the property this
     * design is trying not to have; three session events are worth an explicit
     * second door.
     */
    const recordSession = (
      actor: Audit.Actor,
      action: Audit.AuditAction,
      userId?: string | undefined,
    ): Effect.Effect<void, RepositoryFailure> =>
      Effect.gen(function* () {
        const at = yield* DateTime.nowAsDate;

        yield* entries.record(
          Audit.AuditEntry.make({
            id: entryId(),
            at,
            actor,
            action,
            entity: "user",
            entityId: Option.fromNullable(userId),
            before: Option.none(),
            after: Option.none(),
          }),
        );
      });

    return {
      record,
      recordSession,

      /** The most recent entries, for the compliance screen. */
      trail: (
        limit = 100,
      ): Effect.Effect<
        readonly Audit.AuditEntry[],
        NotPermitted | RepositoryFailure,
        CurrentUser
      > => Effect.flatMap(permitted("audit:read"), () => entries.recent(limit)),

      /**
       * The history of one record.
       *
       * Takes the same permission as the whole trail rather than a weaker one.
       * "Who has touched this matter" is the same question as "who has touched
       * anything", asked one row at a time.
       */
      forEntity: (
        entity: Audit.AuditedEntity,
        id: string,
      ): Effect.Effect<
        readonly Audit.AuditEntry[],
        NotPermitted | NotFound | RepositoryFailure,
        CurrentUser
      > =>
        Effect.flatMap(permitted("audit:read"), () =>
          entries.forEntity(entity, id),
        ),
    };
  }),
}) {}
