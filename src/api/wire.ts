import { Schema } from "effect";
import * as Billing from "../domain/billing/invoice";
import * as Matter from "../domain/case/case";
import type * as Limitation from "../domain/case/limitation";
import * as ClientDomain from "../domain/client/client";
import * as Firm from "../domain/firm/advocate";
import * as DocumentDomain from "../domain/document/document";
import * as Work from "../domain/work/task";
import * as Correspondence from "../domain/message/message";
import * as HearingDomain from "../domain/court/hearing";
import * as Ledger from "../domain/trust/ledger";
import * as TimeDomain from "../domain/time/entry";

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
export const Timestamp = Schema.Date.annotations({
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

/**
 * The one schema here that restates a *rule* as well as a date.
 *
 * Everything else in this file is a mechanical date substitution over the
 * domain's own `fields`, which is what keeps it from drifting. A payment is the
 * exception: the domain applies a struct-level filter — an M-Pesa payment must
 * carry its confirmation code — and a filter is not a field, so spreading
 * `PaymentFields` alone would put a schema on the wire that accepts what the
 * domain refuses. An API that takes a payment the service will then reject is
 * an API that has to be tried before it can be understood.
 *
 * The predicate itself is imported rather than rewritten, so there is one
 * statement of the rule and this is a second application of it.
 */
const Payment = Schema.Struct({
  ...Billing.PaymentFields,
  receivedOn: Timestamp,
}).pipe(
  Schema.filter((payment) =>
    Billing.isReconcilable(payment) ? undefined : Billing.RECONCILABLE_MESSAGE,
  ),
);

/**
 * A trust movement, dated for the wire.
 *
 * The amount stays a positive integer and the direction stays in the reason,
 * exactly as the domain has it. A signed amount would be smaller on the wire
 * and would let a "deposit" of minus five thousand pass every check in the
 * system — see `domain/trust/ledger.ts`, which explains why that shape was
 * refused in the first place.
 */
export const TrustMovement = Schema.Struct({
  ...Ledger.TrustMovement.fields,
  recordedAt: Timestamp,
}).annotations({
  identifier: "TrustMovement",
  description: "One entry in a client's trust ledger",
});

/**
 * A time entry, dated for the wire.
 *
 * `invoicedOn` is a `Schema.Option`, which encodes to the tagged form
 * `{"_tag":"Some","value":"…"}` rather than to a nullable string. That is
 * uglier on the wire than `invoiceId: string | null` and is what the domain
 * holds, so it is what crosses — a wire schema that flattened it would be a
 * second model, and the drift guard below exists to make sure there is not one.
 */
export const TimeEntry = Schema.Struct({
  ...TimeDomain.TimeEntry.fields,
  workedOn: Timestamp,
}).annotations({
  identifier: "TimeEntry",
  description: "A recorded unit of work",
});

/**
 * A hearing, dated for the wire.
 *
 * `outcome` is the domain's tagged union unchanged, and that matters: only
 * `Adjourned` carries a destination, so a client cannot receive an adjournment
 * with nowhere recorded to have gone. Flattening it to
 * `{ outcome: string, adjournedTo?: string }` would hand every consumer exactly
 * the shape the domain refuses — and the destination is the thing that stops a
 * matter falling off the diary.
 *
 * The nested date inside `Adjourned` has to be restated too, which is why the
 * union is rebuilt here rather than spread: it is the one place in this file
 * where a date is not at the top level.
 */
const Outcome = Schema.Union(
  Schema.TaggedStruct("Heard", { note: Schema.optional(Schema.String) }),
  Schema.TaggedStruct("Adjourned", {
    adjournedTo: Timestamp,
    reason: Schema.NonEmptyTrimmedString,
  }),
  Schema.TaggedStruct("NotReached", { note: Schema.optional(Schema.String) }),
  Schema.TaggedStruct("Withdrawn", { note: Schema.optional(Schema.String) }),
);

export const Hearing = Schema.Struct({
  ...HearingDomain.Hearing.fields,
  scheduledFor: Timestamp,
  outcome: Schema.optional(Outcome),
}).annotations({
  identifier: "Hearing",
  description: "A court date, and how it went once somebody has recorded it",
});

/**
 * A document on a matter file, dated for the wire.
 *
 * `versions` is a `NonEmptyArray` here as in the domain, because a document
 * with no version is just a name and every consumer downstream would have to
 * decide what that means. `storageKey` crosses too, and deliberately: it is not
 * a secret — the store is private, so the key alone opens nothing, and a signed
 * URL is issued only by `/documents/:id/download` after the permission and the
 * scope have been checked.
 */
const DocumentVersion = Schema.Struct({
  ...DocumentDomain.Version.fields,
  uploadedOn: Timestamp,
});

export const Document = Schema.Struct({
  ...DocumentDomain.Document.fields,
  versions: Schema.NonEmptyArray(DocumentVersion),
}).annotations({
  identifier: "Document",
  description:
    "A document on a matter file. Versions are append-only: a filed pleading " +
    "is evidence of what was said at that moment, and replacing its contents " +
    "destroys the answer to the question people actually ask",
});

/**
 * A task, with both of its dates as timestamps.
 *
 * `raisedOn` and `dueOn` are *days* in the domain and in Postgres — a task is
 * due on the 20th, not at a moment on the 20th. They still cross the wire as
 * ISO-8601 date-times, because there is no JSON date type and inventing one
 * here would mean every consumer parsing a bespoke format. Midnight UTC is what
 * they carry, and the description says so rather than leaving a reader to infer
 * that a task is due at exactly one second past midnight.
 */
export const Task = Schema.Struct({
  ...Work.TaskFields,
  raisedOn: Timestamp,
  dueOn: Timestamp,
  completed: Schema.Option(
    Schema.Struct({ ...Work.Completion.fields, on: Timestamp }),
  ),
})
  // The invariant crosses the boundary rather than being dropped on the way
  // out. A `Done` task with no completion record is not describable here
  // either.
  .pipe(Schema.filter(Work.doneIffCompleted))
  .annotations({
    identifier: "Task",
    description:
      "Outstanding work. `caseId` is absent for firm work — reconciling the " +
      "trust account has no file number — and `completed` is present exactly " +
      "when `status` is `Done`. Both dates are days carried at midnight UTC",
  });

/**
 * A message on a client thread.
 *
 * `author` crosses the wire as the tagged union it is, so a consumer branches
 * on `_tag` rather than testing an `advocateId` for null and hoping the two
 * columns agreed. A `FromClient` carries no name because there is none to
 * carry: the portal login belongs to the client, which for a company is an
 * organisation rather than a person.
 */
export const Message = Schema.Struct({
  ...Correspondence.Message.fields,
  sentAt: Timestamp,
  readAt: Schema.Option(Timestamp),
}).annotations({
  identifier: "Message",
  description:
    "Correspondence between a client and the firm. Append-only in the domain, " +
    "in Postgres and on this API: there is no endpoint that edits or withdraws " +
    "one, because what was said to a client is part of the retainer's history",
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
  readonly trustMovement: Identical<
    typeof TrustMovement.Type,
    Ledger.TrustMovement
  >;
  readonly timeEntry: Identical<typeof TimeEntry.Type, TimeDomain.TimeEntry>;
  readonly hearing: Identical<typeof Hearing.Type, HearingDomain.Hearing>;
  readonly document: Identical<typeof Document.Type, DocumentDomain.Document>;
  readonly task: Identical<typeof Task.Type, Work.Task>;
  readonly message: Identical<typeof Message.Type, Correspondence.Message>;
  readonly limitation: Identical<
    typeof LimitationWindow.Type,
    Limitation.LimitationWindow
  >;
} = {
  case: true,
  advocate: true,
  client: true,
  invoice: true,
  trustMovement: true,
  timeEntry: true,
  hearing: true,
  document: true,
  task: true,
  message: true,
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
  readonly trustMovement: IsJson<typeof TrustMovement.Encoded>;
  readonly timeEntry: IsJson<typeof TimeEntry.Encoded>;
  readonly hearing: IsJson<typeof Hearing.Encoded>;
  readonly document: IsJson<typeof Document.Encoded>;
  readonly task: IsJson<typeof Task.Encoded>;
  readonly message: IsJson<typeof Message.Encoded>;
  readonly limitation: IsJson<typeof LimitationWindow.Encoded>;
} = {
  case: true,
  advocate: true,
  client: true,
  invoice: true,
  trustMovement: true,
  timeEntry: true,
  hearing: true,
  document: true,
  task: true,
  message: true,
  limitation: true,
};
