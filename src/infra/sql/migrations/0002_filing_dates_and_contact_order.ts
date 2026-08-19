import { SqlClient } from "@effect/sql";
import { Effect } from "effect";

/**
 * Two corrections that only became visible once rows had to round-trip through
 * the domain model.
 *
 * Both are the same kind of mistake: a column that stores something the domain
 * needs, in a form that cannot express it. Writing the repositories is what
 * surfaced them, which is the argument for building the mapping layer before
 * declaring a schema finished.
 */
export const statements: readonly string[] = [
  /**
   * 1. `filed_on` was `NOT NULL DEFAULT '1970-01-01'`, with the epoch standing
   *    in for "not filed yet".
   *
   * The domain's `filedOn` is optional and `isFiled` is defined as its presence,
   * so the sentinel had to be encoded on write and decoded on read — and any
   * other writer (an import, a psql session) that left the default in place was
   * recording a matter filed on 1 January 1970. A matter opened before 1970 is
   * not a real case, but neither is that a reason to keep an unrepresentable
   * state representable: `NULL` says "not filed" and cannot be mistaken for a
   * date.
   */
  `
    ALTER TABLE cases ALTER COLUMN filed_on DROP DEFAULT;
    ALTER TABLE cases ALTER COLUMN filed_on DROP NOT NULL;
    UPDATE cases SET filed_on = NULL WHERE filed_on = DATE '1970-01-01';

    ALTER TABLE cases DROP CONSTRAINT cause_number_needs_filing;
    ALTER TABLE cases ADD CONSTRAINT cause_number_needs_filing CHECK (
      cause_number IS NULL OR filed_on IS NOT NULL
    );

    ALTER TABLE cases DROP CONSTRAINT filed_after_opened;
    ALTER TABLE cases ADD CONSTRAINT filed_after_opened CHECK (
      filed_on IS NULL OR filed_on >= opened_on
    );
  `,

  /**
   * 2. `client_contacts` had no ordering column.
   *
   * The domain's `primaryContact` is `contacts[0]` — the person the firm takes
   * instructions from. A `SELECT` with no `ORDER BY` has no defined order, so
   * "who instructs us" was decided by whatever Postgres happened to return
   * first, and could change after a vacuum. That is not a flaky test waiting to
   * happen; it is the wrong person being contacted about a matter.
   *
   * `ordinal`, not `position`: `POSITION` is a SQL function name, and a column
   * that needs quoting in half its uses eventually gets one of them wrong.
   */
  `
    ALTER TABLE client_contacts ADD COLUMN ordinal integer;

    UPDATE client_contacts AS c
       SET ordinal = ranked.rn
      FROM (
        SELECT id,
               row_number() OVER (PARTITION BY client_id ORDER BY id) - 1 AS rn
          FROM client_contacts
      ) AS ranked
     WHERE c.id = ranked.id;

    ALTER TABLE client_contacts ALTER COLUMN ordinal SET NOT NULL;

    ALTER TABLE client_contacts
      ADD CONSTRAINT client_contacts_ordinal_nonneg CHECK (ordinal >= 0);

    -- Two contacts cannot both be first.
    ALTER TABLE client_contacts
      ADD CONSTRAINT client_contacts_ordinal_unique UNIQUE (client_id, ordinal);
  `,
];

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const statement of statements) {
    yield* sql.unsafe(statement);
  }
});
