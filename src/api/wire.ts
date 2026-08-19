import { Schema } from "effect";
import * as Billing from "../domain/billing/invoice";
import * as Matter from "../domain/case/case";
import type * as Limitation from "../domain/case/limitation";
import * as ClientDomain from "../domain/client/client";
import * as Firm from "../domain/firm/advocate";

/**
 * The domain, in a shape that survives JSON.
 *
 * Every date in `domain/` is `Schema.DateFromSelf`, which was the right call in
 * Phase 1 and is the one thing that cannot cross a network. `DateFromSelf`
 * *encodes to a `Date`*, and a `Date` is not a JSON value — the domain schemas
 * describe values in memory, and HTTP needs a description of the same values on
 * a wire. This module is that second description, and nothing more.
 *
 * The interesting question is how to write it without creating a second
 * definition of every entity that then drifts from the first. Two things stop
 * that here:
 *
 * 1. **Each schema is built from the domain's own `fields`.** Only the date
 *    properties are restated. Add `retainerCents` to `Case` and it appears on
 *    the wire in the same commit, with the same constraints, because it is
 *    literally the same schema object.
 *
 * 2. **Two compile-time proofs**, because one is not enough and the second only
 *    became obvious when the first was tested by breaking it on purpose:
 *
 *    - `WIRE_MATCHES_DOMAIN` proves each schema *decodes to* the domain type,
 *      field for field, optionality included. It catches a field added to the
 *      domain and forgotten here, or a restated date whose name is misspelled.
 *    - `WIRE_IS_JSON` proves each schema *encodes to* a JSON value. This is the
 *      one that catches a forgotten date, and the first guard alone cannot:
 *      `DateFromSelf` and `Date` both decode to `Date`, so leaving a field on
 *      `DateFromSelf` passes the equality check and still puts a `Date` on the
 *      wire, where it silently becomes whatever `JSON.stringify` decides.
 *
 * What travels is therefore the *encoded* side of these schemas — ISO-8601
 * strings for dates, plain strings for the branded ids and references — and
 * what a handler returns and a client receives is the domain value itself.
 */

// ── The drift guard ───────────────────────────────────────────────────────

/**
 * Exact type equality, the `<T>() => T extends X ? 1 : 2` trick.
 *
 * Mutual assignability is not enough: `{ a: string }` and `{ a: string; b?: 1 }`
 * are assignable in the direction that matters and would let an optional field
 * appear on the wire that the domain does not have. This is invariant, so both
 * additions and removals fail.
 */
type Identical<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

/**
 * What `JSON.parse` can produce, and therefore what may appear on the wire.
 *
 * `undefined` is included because that is how an absent optional property is
 * typed here; it is omitted from the body rather than encoded as `null`.
 */
type Json =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly Json[]
  | { readonly [key: string]: Json };

/** Whether a schema's *encoded* side is something JSON can carry. */
type IsJson<T> = [T] extends [Json] ? true : false;

// ── Dates ─────────────────────────────────────────────────────────────────

/**
 * A `Date` on the type side, an ISO-8601 string on the wire.
 *
 * `Schema.Date` rather than `Schema.DateFromString`: the lenient one accepts
 * `"tomorrow"` and hands back an `Invalid Date`, which then propagates as a
 * real-looking value until something formats it. This one refuses at the
 * boundary, where the caller can still be told which field was wrong.
 */
const Timestamp = Schema.Date.annotations({
  identifier: "Timestamp",
  description: "An ISO-8601 date-time, e.g. 2026-08-19T00:00:00.000Z",
});

// ── Entities ──────────────────────────────────────────────────────────────

export const Case = Schema.Struct({
  ...Matter.Case.fields,
  accruedOn: Schema.optional(Timestamp),
  openedOn: Timestamp,
  filedOn: Schema.optional(Timestamp),
}).annotations({
  identifier: "Case",
  description: "A matter on the firm's books",
});

export const Advocate = Schema.Struct({
  ...Firm.Advocate.fields,
  admittedOn: Schema.optional(Timestamp),
}).annotations({
  identifier: "Advocate",
  description: "A member of the firm's staff",
});

/**
 * Rebuilt with `Schema.Struct` rather than `Schema.TaggedStruct`, because the
 * `_tag` is already among the domain's `fields` and passing it to
 * `TaggedStruct` again would declare the discriminant twice.
 */
const Individual = Schema.Struct({
  ...ClientDomain.Individual.fields,
  onboardedOn: Timestamp,
});

const Corporate = Schema.Struct({
  ...ClientDomain.Corporate.fields,
  onboardedOn: Timestamp,
});

export const Client = Schema.Union(Individual, Corporate).annotations({
  identifier: "Client",
  description: "A client of the firm: an individual or a corporate entity",
});

const Payment = Schema.Struct({
  ...Billing.Payment.fields,
  receivedOn: Timestamp,
});

export const Invoice = Schema.Struct({
  ...Billing.Invoice.fields,
  issuedOn: Timestamp,
  dueOn: Timestamp,
  payments: Schema.Array(Payment),
}).annotations({
  identifier: "Invoice",
  description: "A fee note. Its total and status are derived, never stored",
});

/**
 * `Limitation.LimitationWindow` is a plain interface rather than a schema —
 * nothing persists one, it is computed on demand from a basis and an accrual
 * date. It still has to be described to be sent, so the description lives here,
 * with the same proof of agreement as everything else.
 */
export const LimitationWindow = Schema.Struct({
  expiresOn: Timestamp,
  provision: Schema.String,
  note: Schema.optional(Schema.String),
}).annotations({
  identifier: "LimitationWindow",
  description:
    "When a claim becomes time-barred, and the provision that says so. " +
    "A prompt to look at the matter, never an authority that it is barred",
});

/**
 * The proof.
 *
 * Exported rather than left as a floating `const`, so it is a value somebody
 * can look at rather than something lint reports as unused — and so the
 * assertion is a declared property of this module rather than a side effect of
 * it. Every entry is `true` only if the wire schema decodes to exactly the
 * domain type; if any is not, this file does not compile.
 */
export const WIRE_MATCHES_DOMAIN: {
  readonly case: Identical<typeof Case.Type, Matter.Case>;
  readonly advocate: Identical<typeof Advocate.Type, Firm.Advocate>;
  readonly client: Identical<typeof Client.Type, ClientDomain.Client>;
  readonly invoice: Identical<typeof Invoice.Type, Billing.Invoice>;
  readonly limitation: Identical<
    typeof LimitationWindow.Type,
    Limitation.LimitationWindow
  >;
} = {
  case: true,
  advocate: true,
  client: true,
  invoice: true,
  limitation: true,
};

/**
 * The other half of the proof: what each schema puts on the wire is JSON.
 *
 * This is the guard that earns its keep. Leaving one field on the domain's
 * `DateFromSelf` satisfies `WIRE_MATCHES_DOMAIN` completely — both decode to
 * `Date` — and fails here, which is the only place the mistake is visible
 * before it reaches a response body.
 */
export const WIRE_IS_JSON: {
  readonly case: IsJson<typeof Case.Encoded>;
  readonly advocate: IsJson<typeof Advocate.Encoded>;
  readonly client: IsJson<typeof Client.Encoded>;
  readonly invoice: IsJson<typeof Invoice.Encoded>;
  readonly limitation: IsJson<typeof LimitationWindow.Encoded>;
} = {
  case: true,
  advocate: true,
  client: true,
  invoice: true,
  limitation: true,
};
