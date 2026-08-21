import { Model } from "@effect/sql";
import { ParseResult, Schema } from "effect";
import {
  AdvocateId,
  CaseId,
  InvoiceId,
  TimeEntryId,
} from "../../domain/shared/ids";
import * as Time from "../../domain/time/entry";
import { CalendarDate, Cents } from "./columns";

/**
 * The `time_entries` table, and the bridge to a `TimeEntry`.
 *
 * Almost a straight mapping, with one column worth stopping on: `invoice_id`.
 *
 * The table has recorded *which* fee note a piece of work went onto since the
 * initial schema. The domain carried `invoiced: boolean` until Phase 7, which
 * meant the mapping had to throw away the identifier on the way out and invent
 * one on the way in — and there is no honest way to invent it. That asymmetry
 * is what made the gap visible: a row↔domain mapping that cannot round-trip is
 * a mapping over two different models.
 *
 * The domain now holds `invoicedOn: Option<InvoiceId>`, `Model.FieldOption`
 * describes the nullable column, and the two are the same shape. `billable` and
 * `invoice_id` are tied by `only_billable_time_is_invoiced` in Postgres and by
 * `markInvoiced` in the domain — the database is the backstop, and the domain
 * is the normal path.
 */
export class TimeEntryRow extends Model.Class<TimeEntryRow>("TimeEntryRow")({
  id: TimeEntryId,
  caseId: CaseId,
  advocateId: AdvocateId,
  activity: Time.Activity,
  minutes: Schema.Int.pipe(Schema.positive()),
  workedOn: CalendarDate,
  billable: Schema.Boolean,
  hourlyRateCents: Cents,
  narrative: Schema.NonEmptyTrimmedString,
  invoiceId: Model.FieldOption(InvoiceId),
  createdAt: Model.Generated(Schema.DateFromSelf),
}) {}

export const TimeEntryFromRow = Schema.transformOrFail(
  TimeEntryRow.insert,
  Schema.typeSchema(Time.TimeEntry),
  {
    strict: true,

    /**
     * The one refusal on the way out.
     *
     * A row that is both non-billable and invoiced cannot be a `TimeEntry`,
     * because `markInvoiced` will not produce one — so if such a row exists,
     * something wrote it around the domain and the honest answer is to refuse
     * rather than to hand back a value the model says cannot exist. Postgres
     * forbids it too; this is what happens if that constraint is ever dropped.
     */
    decode: (row, _options, ast) => {
      if (!row.billable && row.invoiceId._tag === "Some") {
        return ParseResult.fail(
          new ParseResult.Type(
            ast,
            row,
            `"${row.narrative}": recorded as non-billable and carried onto a ` +
              `fee note. One of the two is wrong and this cannot say which`,
          ),
        );
      }

      return ParseResult.succeed({
        id: row.id,
        caseId: row.caseId,
        advocateId: row.advocateId,
        activity: row.activity,
        minutes: row.minutes,
        workedOn: row.workedOn,
        billable: row.billable,
        hourlyRateCents: row.hourlyRateCents,
        narrative: row.narrative,
        invoicedOn: row.invoiceId,
      });
    },

    encode: (entry) =>
      ParseResult.succeed({
        id: entry.id,
        caseId: entry.caseId,
        advocateId: entry.advocateId,
        activity: entry.activity,
        minutes: entry.minutes,
        workedOn: entry.workedOn,
        billable: entry.billable,
        hourlyRateCents: entry.hourlyRateCents,
        narrative: entry.narrative,
        invoiceId: entry.invoicedOn,
      }),
  },
).annotations({ identifier: "TimeEntryFromRow" });
