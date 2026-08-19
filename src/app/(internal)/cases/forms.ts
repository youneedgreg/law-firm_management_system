import { Either, ParseResult, Schema } from "effect";
import * as Matter from "@/domain/case/case";
import * as Limitation from "@/domain/case/limitation";
import * as Court from "@/domain/court/court";
import { AdvocateId, ClientId } from "@/domain/shared/ids";
import * as Money from "@/domain/shared/money";
import type { AmendMatter, OpenMatter } from "@/services/case-service";
import { COURTS } from "./courts";

/**
 * The boundary between a browser form and the domain.
 *
 * Everything arriving from a `<form>` is a string, including the things that
 * are emphatically not strings: a client id, a filing date, a court, a claim
 * value. Somewhere that has to be turned into domain values, and the only two
 * honest places for it are here or scattered through the Server Action with
 * `Number(...)` and `new Date(...)`.
 *
 * It is a schema rather than a parsing function because a schema *refuses*. A
 * hand-written parser produces `NaN` for a mistyped amount and `Invalid Date`
 * for a mistyped date, and both reach the service looking like data. These fail
 * with a message naming the field.
 *
 * The rules themselves are not restated here — `MatterType`, `LimitationBasis`
 * and `ClientId` are the domain's own schemas, so the form cannot accept a
 * matter type the domain does not have.
 */

/**
 * A submission as a plain record, with blank fields removed.
 *
 * An unfilled `<input>` submits `""`, and an unchosen `<select>` submits the
 * placeholder's `""`. Neither means "the empty string" — both mean the field
 * was left alone, which for an optional field is a different thing from a value
 * the schema then has to reject. Dropping them here is what lets every optional
 * field below be a plain `Schema.optional`.
 */
export const submitted = (form: FormData): Record<string, string> => {
  const fields: Record<string, string> = {};
  for (const [name, value] of form.entries()) {
    if (typeof value === "string" && value.trim() !== "") {
      fields[name] = value;
    }
  }
  return fields;
};

/** An unticked checkbox is absent; a ticked one submits `"on"`. */
const Ticked = Schema.transform(Schema.Literal("on"), Schema.Boolean, {
  strict: true,
  decode: () => true,
  encode: () => "on" as const,
});

/**
 * Shillings in, cents stored.
 *
 * A firm writes 4,200,000 and the ledger holds 420,000,000 — the conversion has
 * to happen once, at a boundary, or it happens twice somewhere. `fromShillings`
 * refuses anything finer than a cent rather than rounding it, so `1200.005`
 * fails here instead of quietly becoming `120000` or `120001`.
 */
const ClaimValueCents = Schema.transformOrFail(
  Schema.NumberFromString,
  Schema.Int.pipe(Schema.nonNegative()),
  {
    strict: true,
    decode: (shillings, _options, ast) =>
      Either.match(Money.fromShillings(shillings), {
        onLeft: () =>
          ParseResult.fail(
            new ParseResult.Type(
              ast,
              shillings,
              `${shillings} is finer than a cent; claim values are recorded to the cent`,
            ),
          ),
        onRight: ParseResult.succeed,
      }),
    encode: (cents) => ParseResult.succeed(cents / 100),
  },
);

/**
 * A court, chosen by key from the firm's list.
 *
 * The alternative — four inputs for kind, station, division and rank — would
 * let a form assemble a `MagistratesCourt` with no rank or a Supreme Court with
 * one, which is the combination `Court` is a tagged union to prevent. See
 * `courts.ts`.
 */
const CourtFromKey = Schema.transformOrFail(Schema.String, Court.Court, {
  strict: true,
  decode: (key, _options, ast) => {
    const court = COURTS[key];
    return court === undefined
      ? ParseResult.fail(
          new ParseResult.Type(ast, key, `${key} is not a court on the list`),
        )
      : ParseResult.succeed(court);
  },
  encode: (court, _options, ast) => {
    const found = Object.entries(COURTS).find(
      ([, candidate]) => JSON.stringify(candidate) === JSON.stringify(court),
    );
    return found === undefined
      ? ParseResult.fail(
          new ParseResult.Type(ast, court, "not a court on the firm's list"),
        )
      : ParseResult.succeed(found[0]);
  },
});

// ── Opening a matter ──────────────────────────────────────────────────────

/**
 * The intake form.
 *
 * The decoded type is `OpenMatter` exactly — asserted below rather than
 * described in a comment, so a field added to the service's input and forgotten
 * here fails the build instead of silently never being submitted.
 */
export const OpenMatterForm = Schema.Struct({
  title: Schema.NonEmptyTrimmedString,
  type: Matter.MatterType,
  clientId: ClientId,
  advocateId: AdvocateId,
  court: Schema.optional(CourtFromKey),
  claimValueCents: Schema.optional(ClaimValueCents).pipe(
    Schema.fromKey("claimValueShillings"),
  ),
  underCustomaryLaw: Schema.optionalWith(Ticked, { default: () => false }),
  accruedOn: Schema.optional(Schema.Date),
  limitationBasis: Schema.optional(Limitation.LimitationBasis),
  openedOn: Schema.Date,
  filedOn: Schema.optional(Schema.Date),
  causeNumber: Schema.optional(Schema.NonEmptyTrimmedString),
});

// A compile-time check that the form and the service agree on the shape.
export type OpenMatterFormType = typeof OpenMatterForm.Type;
const _openMatches: OpenMatter = null as unknown as OpenMatterFormType;
void _openMatches;

// ── Amending a matter ─────────────────────────────────────────────────────

/**
 * The edit form.
 *
 * Every field optional, because absence means "leave alone" all the way down —
 * the same contract `AmendMatter` states. A form that submitted only the title
 * must not blank the claim value.
 *
 * The checkbox is the one field that always carries a value, and it is not an
 * exception to that rule: an unticked box is not a field left alone, it is the
 * user saying the claim is not under customary law.
 */
export const AmendMatterForm = Schema.Struct({
  title: Schema.optional(Schema.NonEmptyTrimmedString),
  type: Schema.optional(Matter.MatterType),
  advocateId: Schema.optional(AdvocateId),
  court: Schema.optional(CourtFromKey),
  claimValueCents: Schema.optional(ClaimValueCents).pipe(
    Schema.fromKey("claimValueShillings"),
  ),
  underCustomaryLaw: Schema.optionalWith(Ticked, { default: () => false }),
  accruedOn: Schema.optional(Schema.Date),
  limitationBasis: Schema.optional(Limitation.LimitationBasis),
  filedOn: Schema.optional(Schema.Date),
  causeNumber: Schema.optional(Schema.NonEmptyTrimmedString),
});

export type AmendMatterFormType = typeof AmendMatterForm.Type;
const _amendMatches: AmendMatter = null as unknown as AmendMatterFormType;
void _amendMatches;
