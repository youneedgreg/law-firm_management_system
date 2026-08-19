import { SqlClient } from "@effect/sql";
import { Effect } from "effect";

/**
 * Widens the phone constraint from mobile-only to any Kenyan number.
 *
 * `^\+254[17][0-9]{8}$` accepted mobile ranges and nothing else, matching what
 * `KenyanPhone` used to say. The seed import is what found it: every corporate
 * fixture carries a switchboard landline — `+254 20 445 3021` — and a firm
 * genuinely does hold one for a company. A constraint that cannot represent a
 * real client's number does not prevent bad data; it forces someone to invent
 * a number that passes, which is strictly worse because it looks correct.
 *
 * Nine significant digits either way. The national trunk `0` never appears in
 * E.164, so the first digit stays 1–9 and the constraint still rejects a
 * mistyped `+2540722445109`.
 *
 * Which range a number falls in remains knowable — `phoneKind` in the domain
 * answers it — so Phase 7 can still refuse to send an SMS to a landline. The
 * database's job here is to reject shapes, not to decide policy.
 */
const widen = (table: string, nullable: boolean) => `
  ALTER TABLE ${table} DROP CONSTRAINT ${table}_phone_check;

  ALTER TABLE ${table} ADD CONSTRAINT ${table}_phone_check CHECK (
    ${nullable ? "phone IS NULL OR " : ""}phone ~ '^\\+254[1-9][0-9]{8}$'
  );
`;

export const statements: readonly string[] = [
  widen("clients", false),
  widen("client_contacts", true),
];

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const statement of statements) {
    yield* sql.unsafe(statement);
  }
});
