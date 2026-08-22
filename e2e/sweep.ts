import { existsSync } from "node:fs";
import { Pool } from "pg";

/**
 * Removes everything an end-to-end run created.
 *
 * Registered as **both** `globalSetup` and `globalTeardown`, which is the whole
 * design. A teardown alone cannot clean up after a process that crashed or was
 * interrupted, and the debris a crashed run leaves is precisely what the next
 * run has to not trip over — a second matter called the same thing, a fee note
 * against a client whose balance a spec is about to assert on. Sweeping first
 * makes a run's starting state the same whether or not the previous one
 * finished.
 *
 * ## Everything created is marked
 *
 * Records carry `E2E` in a text field a person would read — a matter's title, a
 * task's. That is deliberately not a hidden column: a marker only the tests
 * know about is one that stops matching the day somebody changes how a record
 * is written, and it fails *silently*, by sweeping nothing. A marker in the
 * title is visible in the application, so debris is visible too.
 *
 * ## What is deleted, and in what order
 *
 * Postgres does most of it. A matter cascades to its time entries, hearings,
 * documents and tasks. An invoice cascades to its lines and payments. The two
 * that need naming are the ones the schema deliberately does *not* cascade:
 * `invoices.case_id` is `ON DELETE SET NULL`, because a fee note outlives the
 * file it was raised against, so an invoice must go before its matter or it is
 * orphaned rather than removed.
 *
 * ## What is deliberately left behind
 *
 * The audit trail. `audit_log` refuses `DELETE` outright — a trigger, so the
 * refusal holds for this script exactly as it holds for a cleanup somebody runs
 * by hand. A run therefore leaves `case.opened`, `time.recorded`,
 * `invoice.raised` and `payment.recorded` entries against the demo account,
 * and that is the Phase 6 guarantee working rather than a leak. Anything that
 * could erase its own trail would be a worse thing than untidy demo data.
 */

/**
 * The prefix every record an end-to-end run creates begins with.
 *
 * Exported so the specs and the sweep read the same constant. Two copies of a
 * marker is the one way this design fails badly: the sweep would match nothing
 * and report success, and the demo data would fill up quietly.
 */
export const MARK = "E2E";

async function sweep(): Promise<void> {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");

  const connectionString = process.env["DATABASE_URL"];
  if (connectionString === undefined) {
    throw new Error(
      "e2e needs DATABASE_URL. It drives the real application against the " +
        "real database; there is nothing to fall back to.",
    );
  }

  // The same pin the application makes in `infra/config.ts`, for the same
  // reason: `pg` treats `sslmode=require` as `verify-full` today and warns
  // that v9 will adopt libpq semantics, where it stops checking who it is
  // talking to. A downgrade that arrives as a dependency bump is one nobody
  // decided on.
  const pool = new Pool({
    connectionString: /[?&]sslmode=/.test(connectionString)
      ? connectionString.replace(/([?&])sslmode=[^&]*/, "$1sslmode=verify-full")
      : `${connectionString}${connectionString.includes("?") ? "&" : "?"}sslmode=verify-full`,
  });
  try {
    // Before the matters, because `invoices.case_id` is SET NULL rather than
    // CASCADE — a fee note outlives the file it was raised against.
    const invoices = await pool.query(
      `DELETE FROM invoices
        WHERE case_id IN (SELECT id FROM cases WHERE title LIKE $1)
        RETURNING id`,
      [`${MARK} %`],
    );
    const cases = await pool.query(
      `DELETE FROM cases WHERE title LIKE $1 RETURNING id`,
      [`${MARK} %`],
    );
    const tasks = await pool.query(
      `DELETE FROM tasks WHERE title LIKE $1 RETURNING id`,
      [`${MARK} %`],
    );

    const removed =
      (invoices.rowCount ?? 0) + (cases.rowCount ?? 0) + (tasks.rowCount ?? 0);
    if (removed > 0) {
      process.stdout.write(
        `[e2e] swept ${String(cases.rowCount ?? 0)} matters, ` +
          `${String(invoices.rowCount ?? 0)} fee notes, ` +
          `${String(tasks.rowCount ?? 0)} tasks\n`,
      );
    }
  } finally {
    await pool.end();
  }
}

export default sweep;
