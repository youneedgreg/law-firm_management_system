import { describe, expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import * as Audit from "../../domain/audit/entry";
import { AuditEntryId, UserId } from "../../domain/shared/ids";
import { EntryFromRow } from "./audit-repository";

/**
 * The audit row ↔ entry mapping, in both directions.
 *
 * Written after the mapping was wrong in production for the length of one
 * browser check. The decode side was reading through `AuditEntry` rather than
 * `Schema.typeSchema(AuditEntry)`, so it expected the *encoded* form of an
 * `Option` — `{ "_tag": "Some", … }` — where a row holds a nullable column.
 *
 * What made it survive every test until then is worth stating: writes go the
 * other way and were correct, the in-memory repository the service tests use
 * has no mapping at all, and the schema tests attack constraints rather than
 * round trips. A one-directional mapping tested in one direction passes.
 * **This test runs the row through both.**
 */

const entryId = Schema.decodeSync(AuditEntryId);
const userId = Schema.decodeSync(UserId);

const AT = new Date("2026-08-20T09:15:00.000Z");

const row = {
  id: "88888888-8888-4888-8888-888888888881",
  at: AT,
  actorUserId: "77777777-7777-4777-8777-777777777771",
  actorName: "Adv. Sarah Wanjiru",
  actorRole: "Managing Partner",
  action: "case.amended",
  entity: "case",
  entityId: "20000000-0000-4000-8000-000000000001",
  before: { status: "New", title: "Old title" },
  after: { status: "New", title: "New title" },
};

describe("reading an entry back out of a row", () => {
  it.effect(
    "turns nullable columns into Options and jsonb into snapshots",
    () =>
      Effect.gen(function* () {
        const entry = yield* Schema.decodeUnknown(EntryFromRow)(row);

        expect(entry.id).toBe(row.id);
        expect(entry.at.toISOString()).toBe(AT.toISOString());
        expect(entry.actor.name).toBe("Adv. Sarah Wanjiru");
        expect(Option.getOrNull(entry.actor.userId)).toBe(row.actorUserId);
        expect(Option.getOrNull(entry.entityId)).toBe(row.entityId);

        // And the whole point of storing both: the field that moved.
        expect(Audit.changes(entry)).toEqual([
          { field: "title", from: "Old title", to: "New title" },
        ]);
      }),
  );

  /** A refused sign-in: no user, no record acted on, no snapshots. */
  it.effect("reads a session event with every nullable column null", () =>
    Effect.gen(function* () {
      const entry = yield* Schema.decodeUnknown(EntryFromRow)({
        ...row,
        action: "session.refused",
        entity: "user",
        actorUserId: null,
        actorName: "someone@example.co.ke",
        actorRole: "Not signed in",
        entityId: null,
        before: null,
        after: null,
      });

      expect(Option.isNone(entry.actor.userId)).toBe(true);
      expect(Option.isNone(entry.entityId)).toBe(true);
      expect(Option.isNone(entry.before)).toBe(true);
      expect(Audit.changes(entry)).toEqual([]);
    }),
  );

  it.effect("refuses an action this build has never heard of", () =>
    Effect.gen(function* () {
      const refused = yield* Effect.flip(
        Schema.decodeUnknown(EntryFromRow)({ ...row, action: "case.deleted" }),
      );

      expect(refused._tag).toBe("ParseError");
    }),
  );
});

describe("writing an entry into a row", () => {
  it.effect("flattens the actor and unwraps the Options", () =>
    Effect.gen(function* () {
      const entry = Audit.AuditEntry.make({
        id: entryId("88888888-8888-4888-8888-888888888882"),
        at: AT,
        actor: Audit.Actor.make({
          userId: Option.some(userId("77777777-7777-4777-8777-777777777771")),
          name: "Adv. Sarah Wanjiru",
          role: "Managing Partner",
        }),
        action: "case.opened",
        entity: "case",
        entityId: Option.some("20000000-0000-4000-8000-000000000001"),
        before: Option.none(),
        after: Option.some({ status: "New" }),
      });

      const written = yield* Schema.encode(EntryFromRow)(entry);

      expect(written.actorUserId).toBe("77777777-7777-4777-8777-777777777771");
      expect(written.actorName).toBe("Adv. Sarah Wanjiru");
      expect(written.before).toBeNull();
      expect(written.after).toEqual({ status: "New" });
    }),
  );

  /**
   * The round trip, which is the assertion that actually protects this file:
   * a row written by the encode side has to be readable by the decode side.
   * Either half being right on its own is what the original bug was.
   */
  it.effect("survives a round trip in both directions", () =>
    Effect.gen(function* () {
      const entry = yield* Schema.decodeUnknown(EntryFromRow)(row);
      const written = yield* Schema.encode(EntryFromRow)(entry);
      const again = yield* Schema.decodeUnknown(EntryFromRow)(written);

      expect(again).toStrictEqual(entry);
    }),
  );
});
