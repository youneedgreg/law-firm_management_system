import { SqlClient } from "@effect/sql";
import { Effect } from "effect";

/**
 * Ordering columns for invoice lines and payments — the same omission that
 * migration 0002 fixed for contacts, in the two other places a domain list is
 * stored as a set of rows.
 *
 * `total` is a sum and does not care, which is exactly why this is easy to
 * miss. What does care: an invoice is a document a client reads, and its lines
 * appearing in a different order every time it is rendered is not a defensible
 * fee note. Payments are a log, and a log with no order is a bag.
 *
 * `received_on` is a `date`, so it cannot break the tie between two payments on
 * the same day — which is precisely when it matters, because that is what a
 * double-posted M-Pesa confirmation looks like.
 */
const addOrdinal = (table: string, parent: string) => `
  ALTER TABLE ${table} ADD COLUMN ordinal integer;

  UPDATE ${table} AS t
     SET ordinal = ranked.rn
    FROM (
      SELECT id,
             row_number() OVER (PARTITION BY ${parent} ORDER BY id) - 1 AS rn
        FROM ${table}
    ) AS ranked
   WHERE t.id = ranked.id;

  ALTER TABLE ${table} ALTER COLUMN ordinal SET NOT NULL;

  ALTER TABLE ${table}
    ADD CONSTRAINT ${table}_ordinal_nonneg CHECK (ordinal >= 0);

  ALTER TABLE ${table}
    ADD CONSTRAINT ${table}_ordinal_unique UNIQUE (${parent}, ordinal);
`;

export const statements: readonly string[] = [
  addOrdinal("invoice_lines", "invoice_id"),
  addOrdinal("payments", "invoice_id"),
];

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const statement of statements) {
    yield* sql.unsafe(statement);
  }
});
