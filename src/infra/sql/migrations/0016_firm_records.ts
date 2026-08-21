import { SqlClient } from "@effect/sql";
import { Effect } from "effect";

/**
 * The firm's own two records: the contact log, and the precedent bank.
 *
 * ## `contacts` is not `messages`, and the schema says so
 *
 * `messages` is correspondence *through* this system — text somebody typed
 * into it, which it delivered and can produce verbatim. It is append-only,
 * enforced by a trigger, because it is evidence.
 *
 * `contacts` is a note *about* a conversation that happened elsewhere: a phone
 * call, a meeting, an email from Outlook. It is somebody's summary, written
 * afterwards, of something this system never saw — testimony rather than
 * evidence. So it has **no append-only trigger**, and that is deliberate: a
 * summary written from memory is exactly the kind of thing that should be
 * correctable, and giving it the weight of a record would be a claim about its
 * reliability that nothing supports.
 *
 * The two tables looking different is the point. A reader should be able to
 * tell from the DDL which one can be relied on in a dispute.
 *
 * ## `precedents.reviewed_on` is nullable and means "never"
 *
 * Not "reviewed when it was filed". A precedent nobody has checked since it
 * went in is the one to be careful of, and defaulting the column to `added_on`
 * would record a review that never happened — the same reasoning that keeps
 * `documents.filed_with_court` from defaulting to false for everything.
 */

export const statements: readonly string[] = [
  `
    CREATE TYPE contact_channel AS ENUM
      ('Email', 'WhatsApp', 'Call', 'Meeting', 'SMS');
    CREATE TYPE contact_direction AS ENUM ('Outgoing', 'Incoming');

    CREATE TABLE contacts (
      id          uuid PRIMARY KEY,
      client_id   uuid NOT NULL REFERENCES clients (id) ON DELETE CASCADE,

      -- Null where the conversation was not about a particular matter.
      case_id     uuid REFERENCES cases (id) ON DELETE SET NULL,

      channel     contact_channel NOT NULL,

      -- Which way it went. The prototype did not record it, and it is the
      -- first question anybody asks of a contact log: did we chase them, or
      -- did they chase us?
      direction   contact_direction NOT NULL,

      logged_by   uuid NOT NULL REFERENCES advocates (id) ON DELETE RESTRICT,
      summary     text NOT NULL CHECK (btrim(summary) <> ''),

      -- A day, not an instant. Nobody remembers what time a call was.
      occurred_on date NOT NULL,
      logged_at   timestamptz NOT NULL DEFAULT now(),

      -- The gap between the two is worth keeping: a note written three weeks
      -- after the call is a different kind of evidence from one written the
      -- same afternoon, and only the pair can show which this was.
      CONSTRAINT logged_after_it_happened CHECK (logged_at >= occurred_on)
    );

    CREATE INDEX contacts_by_client ON contacts (client_id, occurred_on DESC);
  `,

  `
    CREATE TYPE precedent_category AS ENUM
      ('Acts', 'Legal templates', 'Case law', 'Precedents', 'Practice notes');

    CREATE TABLE precedents (
      id          uuid PRIMARY KEY,
      title       text NOT NULL CHECK (btrim(title) <> ''),
      category    precedent_category NOT NULL,

      -- Free text: half a real firm's precedent bank is a lever-arch file, and
      -- a column that only accepted a URL would exclude it and be quietly
      -- wrong about the rest.
      location    text NOT NULL CHECK (btrim(location) <> ''),

      added_by    uuid NOT NULL REFERENCES advocates (id) ON DELETE RESTRICT,
      added_on    date NOT NULL,

      -- Null means never checked. See the note above.
      reviewed_on date,
      note        text CHECK (note IS NULL OR btrim(note) <> ''),

      CONSTRAINT reviewed_after_added CHECK (
        reviewed_on IS NULL OR reviewed_on >= added_on
      )
    );

    CREATE INDEX precedents_by_review ON precedents (reviewed_on NULLS FIRST);
  `,

  `
    ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'contact.logged';
    ALTER TYPE audited_entity ADD VALUE IF NOT EXISTS 'contact';
  `,
];

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const statement of statements) {
    yield* sql.unsafe(statement);
  }
});
