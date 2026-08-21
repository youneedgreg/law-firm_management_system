import { SqlClient } from "@effect/sql";
import { Effect } from "effect";

/**
 * Appointments — the third diary, and the only one with a duration.
 *
 * A hearing is a date the court set; a task is a deadline with no particular
 * hour. An appointment is a time the firm agreed with somebody else, and it
 * **occupies an advocate for a span**. That is what earns it a table rather
 * than a column somewhere: two spans can overlap, and an advocate cannot be in
 * two places at once.
 *
 * ## `minutes`, not an end time
 *
 * The same reasoning `time_entries` uses. A start and an end are two facts that
 * can disagree the moment somebody edits one, and `ends_at < starts_at` is
 * representable if both are stored. A duration cannot be inconsistent with
 * itself, and `CHECK (minutes > 0)` is the whole of the constraint.
 *
 * ## `ON DELETE SET NULL` on both optional references
 *
 * Unlike `messages`, which pins its client and matter with RESTRICT. The
 * difference is what the record *is*: correspondence is evidence about the
 * retainer and must survive; an appointment is a slot in a diary, and one whose
 * matter has gone is a meeting that still happened at a time somebody was
 * occupied. Nulling the reference keeps the diary honest about the occupancy
 * while letting the matter go.
 */

export const statements: readonly string[] = [
  `
    CREATE TYPE appointment_type AS ENUM (
      'Client consultation', 'Internal meeting', 'Site visit', 'Call'
    );

    CREATE TABLE appointments (
      id          uuid PRIMARY KEY,
      title       text NOT NULL CHECK (btrim(title) <> ''),
      type        appointment_type NOT NULL,

      -- Whose diary it occupies. The clash check is per advocate, so this is
      -- the column the index is for.
      advocate_id uuid NOT NULL REFERENCES advocates (id) ON DELETE RESTRICT,

      client_id   uuid REFERENCES clients (id) ON DELETE SET NULL,
      case_id     uuid REFERENCES cases (id) ON DELETE SET NULL,

      starts_at   timestamptz NOT NULL,
      minutes     integer NOT NULL CHECK (minutes > 0),
      location    text CHECK (location IS NULL OR btrim(location) <> ''),

      created_at  timestamptz NOT NULL DEFAULT now()
    );

    -- One advocate's day, which is both the diary view and the clash check.
    CREATE INDEX appointments_by_advocate ON appointments (advocate_id, starts_at);
    CREATE INDEX appointments_by_start ON appointments (starts_at);
  `,
];

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const statement of statements) {
    yield* sql.unsafe(statement);
  }
});
