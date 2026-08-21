import { SqlClient } from "@effect/sql";
import { Effect } from "effect";

/**
 * The client thread.
 *
 * Three decisions the DDL is worth reading for.
 *
 * **The author is two columns constrained to agree, not a nullable id.** A
 * message from the firm names the advocate who wrote it; a message from a
 * client names nobody, because the portal login belongs to an organisation.
 * `author_is_consistent` is what stops a row claiming both or neither — the
 * schema's copy of the domain's tagged union.
 *
 * **`ON DELETE RESTRICT` from `clients`, not CASCADE.** Every other child table
 * in this schema cascades. Correspondence does not: what was said to a client
 * is part of the retainer's history, and a system that silently discards it
 * when somebody tidies up a client record is one that cannot answer "what did
 * you tell them, and when". A client with messages has to have them dealt with
 * deliberately.
 *
 * **`read_at` is a timestamp, not a boolean.** "Did you get my message" is a
 * question with a time in the answer, and the firm's own view needs to tell
 * "not read" from "read on the 3rd and still not answered" — different
 * situations calling for different apologies.
 */

export const statements: readonly string[] = [
  `
    CREATE TYPE message_author AS ENUM ('FromClient', 'FromFirm');

    CREATE TABLE messages (
      id          uuid PRIMARY KEY,
      client_id   uuid NOT NULL REFERENCES clients (id) ON DELETE RESTRICT,

      -- Null for a general enquiry. Forcing a matter would make people pick
      -- one at random, which is worse than not knowing.
      --
      -- RESTRICT, not SET NULL, and the append-only trigger below is why: a
      -- cascade that nulls this column is an *edit* to a message, which the
      -- trigger refuses — so the two would contradict each other and the
      -- delete would fail with a confusing error from the trigger rather than
      -- a clear one from the constraint. Making it explicit says the real
      -- rule: a matter with correspondence on it has to be dealt with
      -- deliberately, exactly like a client.
      case_id     uuid REFERENCES cases (id) ON DELETE RESTRICT,

      author      message_author NOT NULL,
      advocate_id uuid REFERENCES advocates (id) ON DELETE RESTRICT,

      body        text NOT NULL CHECK (btrim(body) <> ''),
      sent_at     timestamptz NOT NULL DEFAULT now(),
      read_at     timestamptz,

      -- The tagged union, in SQL. A firm message has an advocate; a client
      -- message has none.
      CONSTRAINT author_is_consistent CHECK (
        (author = 'FromFirm') = (advocate_id IS NOT NULL)
      ),

      CONSTRAINT read_after_sent CHECK (read_at IS NULL OR read_at >= sent_at)
    );

    -- One thread, in order: the only read the screens make.
    CREATE INDEX messages_by_client ON messages (client_id, sent_at);

    -- The unanswered queue reads client messages newest-first per client.
    CREATE INDEX messages_from_clients ON messages (client_id, sent_at DESC)
      WHERE author = 'FromClient';
  `,

  /**
   * Append-only, enforced by the database.
   *
   * The same treatment the audit trail gets, and for a related reason: what was
   * said to a client is evidence about the retainer. `read_at` is the sole
   * exception — marking a message read is not revising it, and it is the one
   * field whose value is not a claim by the author.
   *
   * Both foreign keys are `RESTRICT` so that nothing else can edit a row
   * behind this trigger's back. A `CASCADE` or a `SET NULL` would be a write
   * the trigger then refuses, turning a delete into an error nobody can read.
   */
  `
    CREATE FUNCTION messages_are_append_only() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'messages cannot be deleted';
      END IF;

      IF NEW.id          IS DISTINCT FROM OLD.id
      OR NEW.client_id   IS DISTINCT FROM OLD.client_id
      OR NEW.case_id     IS DISTINCT FROM OLD.case_id
      OR NEW.author      IS DISTINCT FROM OLD.author
      OR NEW.advocate_id IS DISTINCT FROM OLD.advocate_id
      OR NEW.body        IS DISTINCT FROM OLD.body
      OR NEW.sent_at     IS DISTINCT FROM OLD.sent_at THEN
        RAISE EXCEPTION 'a message cannot be edited; send a correction instead';
      END IF;

      -- First read wins. "When did you first see this" has one answer.
      IF OLD.read_at IS NOT NULL AND NEW.read_at IS DISTINCT FROM OLD.read_at THEN
        RAISE EXCEPTION 'a message has already been read; the first time stands';
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER messages_append_only
      BEFORE UPDATE OR DELETE ON messages
      FOR EACH ROW EXECUTE FUNCTION messages_are_append_only();
  `,

  `
    ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'message.sent';
    ALTER TYPE audited_entity ADD VALUE IF NOT EXISTS 'message';
  `,
];

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const statement of statements) {
    yield* sql.unsafe(statement);
  }
});
