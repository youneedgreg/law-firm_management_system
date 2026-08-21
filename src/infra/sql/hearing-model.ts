import { Model } from "@effect/sql";
import { Option, ParseResult, Schema } from "effect";
import * as Court from "../../domain/court/court";
import * as Hearing from "../../domain/court/hearing";
import { AdvocateId, CaseId, HearingId } from "../../domain/shared/ids";
import { CourtKind, flattenCourt, rebuildCourt } from "./court-columns";

/**
 * The `hearings` table, and the bridge to a `Hearing`.
 *
 * Two shapes have to be reconciled here, and the second is the interesting one.
 *
 * The court is flattened across four columns, exactly as `cases` flattens it —
 * one mapping, in `court-columns.ts`, used by both.
 *
 * **The outcome is a tagged union across four nullable columns**, and this is
 * where the table and the domain disagree most. `Outcome` is
 * `Heard | Adjourned | NotReached | Withdrawn`, and only `Adjourned` carries
 * anything — the date the matter went to, and why. The table stores `outcome`,
 * `outcome_note`, `adjourned_to` and `adjourned_reason`, tied by
 * `adjournment_has_destination`: a date only for an adjournment, and an
 * adjournment only with a date.
 *
 * That constraint is the one that stops matters falling off the diary, and this
 * mapping refuses the same combinations rather than trusting it. "The
 * constraint should have caught it" is not a reason to hand back an `Adjourned`
 * with an undefined destination and let a diary view try to render it.
 */
export class HearingRow extends Model.Class<HearingRow>("HearingRow")({
  id: HearingId,
  caseId: CaseId,
  kind: Hearing.HearingKind,
  courtKind: CourtKind,
  courtStation: Model.FieldOption(Schema.String),
  courtDivision: Model.FieldOption(Schema.String),
  courtRank: Model.FieldOption(Court.MagistrateRank),
  room: Model.FieldOption(Schema.NonEmptyTrimmedString),
  scheduledFor: Schema.DateFromSelf,
  advocateId: AdvocateId,
  outcome: Model.FieldOption(
    Schema.Literal("Heard", "Adjourned", "NotReached", "Withdrawn"),
  ),
  outcomeNote: Model.FieldOption(Schema.String),
  adjournedTo: Model.FieldOption(Schema.DateFromSelf),
  adjournedReason: Model.FieldOption(Schema.NonEmptyTrimmedString),
}) {}

/** The four outcome columns, as one value. */
interface OutcomeColumns {
  readonly outcome: Option.Option<
    "Heard" | "Adjourned" | "NotReached" | "Withdrawn"
  >;
  readonly outcomeNote: Option.Option<string>;
  readonly adjournedTo: Option.Option<Date>;
  readonly adjournedReason: Option.Option<string>;
}

const noOutcome: OutcomeColumns = {
  outcome: Option.none(),
  outcomeNote: Option.none(),
  adjournedTo: Option.none(),
  adjournedReason: Option.none(),
};

/**
 * Splits an outcome across four columns.
 *
 * Exhaustive by construction, like `flattenCourt`. The three non-adjournment
 * outcomes differ only in their tag, and their optional note goes to
 * `outcome_note`; `Adjourned` is the one that fills the other two columns, and
 * must.
 */
const flattenOutcome = (outcome: Hearing.Outcome): OutcomeColumns => {
  switch (outcome._tag) {
    case "Adjourned":
      return {
        outcome: Option.some("Adjourned"),
        outcomeNote: Option.none(),
        adjournedTo: Option.some(outcome.adjournedTo),
        adjournedReason: Option.some(outcome.reason),
      };

    case "Heard":
    case "NotReached":
    case "Withdrawn":
      return {
        ...noOutcome,
        outcome: Option.some(outcome._tag),
        outcomeNote: Option.fromNullable(outcome.note),
      };
  }
};

/** Rebuilds an outcome, or says what the row is missing. */
const rebuildOutcome = (
  columns: OutcomeColumns,
): Option.Option<Hearing.Outcome> | { readonly missing: string } => {
  if (Option.isNone(columns.outcome)) return Option.none();

  const note = Option.getOrUndefined(columns.outcomeNote);

  switch (columns.outcome.value) {
    case "Adjourned": {
      const adjournedTo = Option.getOrUndefined(columns.adjournedTo);
      const reason = Option.getOrUndefined(columns.adjournedReason);

      /**
       * The refusal that matters.
       *
       * An adjournment with no destination is a matter that has fallen off the
       * diary — everybody remembers it was adjourned and nobody records where
       * it went. `adjournment_has_destination` forbids the row; this refuses to
       * hand one back as a `Hearing` if it ever exists.
       */
      if (adjournedTo === undefined || reason === undefined) {
        return {
          missing:
            "outcome is Adjourned but the row does not say where the matter " +
            "went, or why",
        };
      }

      return Option.some(
        Hearing.Outcome.members[1].make({ adjournedTo, reason }),
      );
    }

    case "Heard":
      return Option.some(
        Hearing.Outcome.members[0].make(note === undefined ? {} : { note }),
      );

    case "NotReached":
      return Option.some(
        Hearing.Outcome.members[2].make(note === undefined ? {} : { note }),
      );

    case "Withdrawn":
      return Option.some(
        Hearing.Outcome.members[3].make(note === undefined ? {} : { note }),
      );
  }
};

export const HearingFromRow = Schema.transformOrFail(
  HearingRow.insert,
  Schema.typeSchema(Hearing.Hearing),
  {
    strict: true,

    decode: (row, _options, ast) => {
      const court = rebuildCourt({
        courtKind: Option.some(row.courtKind),
        courtStation: row.courtStation,
        courtDivision: row.courtDivision,
        courtRank: row.courtRank,
      });

      if ("missing" in court) {
        return ParseResult.fail(new ParseResult.Type(ast, row, court.missing));
      }

      /**
       * A hearing without a court cannot exist.
       *
       * `Case.court` is optional — a matter before the Tax Appeals Tribunal is
       * outside the Article 162 hierarchy — but a *hearing* is a court date by
       * definition, so `hearings.court_kind` is `NOT NULL` and the domain's
       * `Hearing.court` is required. `rebuildCourt` answers with an `Option`
       * because it serves both tables; this is where the two part company.
       */
      if (Option.isNone(court)) {
        return ParseResult.fail(
          new ParseResult.Type(ast, row, "a hearing with no court"),
        );
      }

      const outcome = rebuildOutcome(row);
      if ("missing" in outcome) {
        return ParseResult.fail(
          new ParseResult.Type(ast, row, outcome.missing),
        );
      }

      const room = Option.getOrUndefined(row.room);

      return ParseResult.succeed({
        id: row.id,
        caseId: row.caseId,
        kind: row.kind,
        court: court.value,
        scheduledFor: row.scheduledFor,
        advocateId: row.advocateId,
        ...(room === undefined ? {} : { room }),
        ...(Option.isNone(outcome) ? {} : { outcome: outcome.value }),
      });
    },

    encode: (hearing) => {
      const court = flattenCourt(hearing.court);

      /**
       * `court_kind` is `NOT NULL` on this table, and `flattenCourt` always
       * sets it — the `Option` is there for `cases`, where a court is
       * genuinely optional. Refusing rather than defaulting keeps the two
       * tables' different requirements visible instead of papering over them.
       */
      if (Option.isNone(court.courtKind)) {
        return ParseResult.fail(
          new ParseResult.Forbidden(
            Schema.typeSchema(Hearing.Hearing).ast,
            hearing,
            "a hearing with no court",
          ),
        );
      }

      return ParseResult.succeed({
        id: hearing.id,
        caseId: hearing.caseId,
        kind: hearing.kind,
        courtKind: court.courtKind.value,
        courtStation: court.courtStation,
        courtDivision: court.courtDivision,
        courtRank: court.courtRank,
        room: Option.fromNullable(hearing.room),
        scheduledFor: hearing.scheduledFor,
        advocateId: hearing.advocateId,
        ...(hearing.outcome === undefined
          ? noOutcome
          : flattenOutcome(hearing.outcome)),
      });
    },
  },
).annotations({ identifier: "HearingFromRow" });
