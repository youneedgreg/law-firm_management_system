import { SqlClient, SqlSchema } from "@effect/sql";
import { Effect, Layer, Option, Schema } from "effect";
import { AdvocateId, CaseId, TimeEntryId } from "../../domain/shared/ids";
import type * as Time from "../../domain/time/entry";
import {
  NotFound,
  TimeRepository,
  type RepositoryFailure,
} from "../../services/repositories";
import { reading, writing } from "./resilience";
import { TimeEntryFromRow } from "./time-model";

/**
 * Recorded work, in Postgres.
 *
 * Every read goes through `SqlSchema` with `TimeEntryFromRow` as its result
 * schema, so a query hands back `TimeEntry` values rather than a bag of
 * columns — the `invoice_id` column stops existing at this boundary and becomes
 * the domain's `invoicedOn`.
 *
 * `carryOnto` at the bottom is the only statement here worth reading twice.
 */
export const TimeRepositoryLive = Layer.effect(
  TimeRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const findById = SqlSchema.findOne({
      Request: TimeEntryId,
      Result: TimeEntryFromRow,
      execute: (id) => sql`SELECT * FROM time_entries WHERE id = ${id}`,
    });

    const forCase = SqlSchema.findAll({
      Request: CaseId,
      Result: TimeEntryFromRow,
      execute: (caseId) => sql`
        SELECT * FROM time_entries
         WHERE case_id = ${caseId}
         ORDER BY worked_on DESC, created_at DESC
      `,
    });

    const forAdvocate = SqlSchema.findAll({
      Request: AdvocateId,
      Result: TimeEntryFromRow,
      execute: (advocateId) => sql`
        SELECT * FROM time_entries
         WHERE advocate_id = ${advocateId}
         ORDER BY worked_on DESC, created_at DESC
      `,
    });

    /**
     * Shaped to the `time_entries_unbilled` partial index, over
     * `invoice_id IS NULL AND billable` — so the index is used rather than
     * merely present. Kept as two statements rather than one with a nullable
     * parameter, because a `case_id = coalesce($1, case_id)` reads as clever
     * and plans as a sequential scan.
     */
    const unbilledForCase = SqlSchema.findAll({
      Request: CaseId,
      Result: TimeEntryFromRow,
      execute: (caseId) => sql`
        SELECT * FROM time_entries
         WHERE invoice_id IS NULL AND billable AND case_id = ${caseId}
         ORDER BY worked_on
      `,
    });

    const unbilledEverywhere = SqlSchema.findAll({
      Request: Schema.Void,
      Result: TimeEntryFromRow,
      execute: () => sql`
        SELECT * FROM time_entries
         WHERE invoice_id IS NULL AND billable
         ORDER BY worked_on
      `,
    });

    const recent = SqlSchema.findAll({
      Request: Schema.Int,
      Result: TimeEntryFromRow,
      execute: (limit) => sql`
        SELECT * FROM time_entries
         ORDER BY worked_on DESC, created_at DESC
         LIMIT ${limit}
      `,
    });

    return TimeRepository.of({
      byId: (id) =>
        findById(id).pipe(
          reading("TimeRepository.byId"),
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(new NotFound({ entity: "TimeEntry", id })),
              onSome: Effect.succeed<Time.TimeEntry>,
            }),
          ),
        ),

      forCase: (caseId) =>
        forCase(caseId).pipe(reading("TimeRepository.forCase")),

      forAdvocate: (advocateId) =>
        forAdvocate(advocateId).pipe(reading("TimeRepository.forAdvocate")),

      unbilled: (caseId) =>
        (caseId === undefined
          ? unbilledEverywhere()
          : unbilledForCase(caseId)
        ).pipe(reading("TimeRepository.unbilled")),

      recent: (limit) => recent(limit).pipe(reading("TimeRepository.recent")),

      save: (entry) =>
        Schema.encode(TimeEntryFromRow)(entry).pipe(
          Effect.flatMap(
            (row) => sql`
              INSERT INTO time_entries ${sql.insert(row)}
              ON CONFLICT (id) DO UPDATE SET ${sql.update(row, ["id"])}
            `,
          ),
          Effect.as(entry),
          writing("TimeRepository.save"),
        ) satisfies Effect.Effect<Time.TimeEntry, RepositoryFailure>,

      /**
       * Claims a set of entries for one fee note, in a single statement.
       *
       * Two properties, and both come from writing it this way rather than as a
       * loop:
       *
       * **It cannot half-succeed.** A loop of updates that fails on the fourth
       * of six leaves three entries marked as billed on a fee note that will
       * never be raised — work the firm has done, cannot bill again, and has no
       * record of having lost.
       *
       * **`invoice_id IS NULL` makes the claim atomic.** Two people generating
       * a fee note from the same matter at the same moment both read the same
       * unbilled entries; the first `UPDATE` takes them and the second matches
       * nothing. The returned count is how the caller finds out — it asked for
       * six and got two, so it must not raise a fee note for six hours' work.
       * A version that ignored the count would double-bill under contention,
       * which is the precise failure this design exists to prevent.
       *
       * `AND billable` is redundant against `only_billable_time_is_invoiced`
       * and is there anyway: the constraint says the row cannot exist, and this
       * says the statement will not try to create it.
       */
      carryOnto: (invoiceId, entries) =>
        entries.length === 0
          ? Effect.succeed(0)
          : sql<{ readonly id: string }>`
              UPDATE time_entries
                 SET invoice_id = ${invoiceId}
               WHERE id IN ${sql.in(entries)}
                 AND invoice_id IS NULL
                 AND billable
              RETURNING id
            `.pipe(
              Effect.map((rows) => rows.length),
              writing("TimeRepository.carryOnto"),
            ),
    });
  }),
);
