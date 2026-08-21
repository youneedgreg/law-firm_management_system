import { Schema } from "effect";

/**
 * Identifiers and the formatted strings the firm treats as identifiers.
 *
 * Every entity id is a branded UUID rather than a number. Two reasons, and the
 * second is the one that matters here:
 *
 * 1. `CaseId` and `ClientId` are both branded, so passing one where the other
 *    is expected does not compile. With bare numbers it always compiles.
 * 2. Ids appear in client-portal URLs. Sequential integers invite enumeration —
 *    a portal user who can read `/cases/41` will try `/cases/42`. Authorization
 *    is still checked on every read (Phase 6); unguessable ids just mean a
 *    mistake there is not trivially exploitable.
 *
 * The seed data in `src/lib/data/` still uses small integers. Phase 2's seed
 * script mints real UUIDs; until then the two do not meet.
 */

const entityId = <const B extends string>(brand: B) =>
  Schema.UUID.pipe(
    Schema.brand(brand),
    Schema.annotations({ identifier: brand }),
  );

export const CaseId = entityId("CaseId");
export type CaseId = typeof CaseId.Type;

export const ClientId = entityId("ClientId");
export type ClientId = typeof ClientId.Type;

export const InvoiceId = entityId("InvoiceId");
export type InvoiceId = typeof InvoiceId.Type;

export const AdvocateId = entityId("AdvocateId");
export type AdvocateId = typeof AdvocateId.Type;

export const DocumentId = entityId("DocumentId");
export type DocumentId = typeof DocumentId.Type;

export const HearingId = entityId("HearingId");
export type HearingId = typeof HearingId.Type;

export const TaskId = entityId("TaskId");
export type TaskId = typeof TaskId.Type;

export const MessageId = entityId("MessageId");
export type MessageId = typeof MessageId.Type;

export const ContactId = entityId("ContactId");
export type ContactId = typeof ContactId.Type;

export const PrecedentId = entityId("PrecedentId");
export type PrecedentId = typeof PrecedentId.Type;

export const TrustMovementId = entityId("TrustMovementId");
export type TrustMovementId = typeof TrustMovementId.Type;

/**
 * A recorded unit of work.
 *
 * `TimeEntry` had no identity through Phase 1, which was defensible while
 * nothing could be done to one: a time entry looked like a fact about a matter
 * rather than a record in its own right. Phase 7 gave it two operations that
 * need to name a single entry — correcting one, and carrying one onto a fee
 * note — and both are impossible against a value with no key.
 */
export const TimeEntryId = entityId("TimeEntryId");
export type TimeEntryId = typeof TimeEntryId.Type;

/**
 * A login, which is not the same thing as a person's staff or client record.
 *
 * Separate from `AdvocateId` and `ClientId` on purpose: an advocate who has
 * never been given a login still exists and still carries matters, and a login
 * that is disabled leaves the staff record it pointed at untouched. Collapsing
 * the two would mean deleting a login deleted the advocate.
 */
export const UserId = entityId("UserId");
export type UserId = typeof UserId.Type;

export const AuditEntryId = entityId("AuditEntryId");
export type AuditEntryId = typeof AuditEntryId.Type;

// ── Formatted identifiers ─────────────────────────────────────────────────

/**
 * The firm's own matter reference, e.g. `OKL-2026-014`.
 *
 * A firm convention rather than a court one: the court assigns its own cause
 * number, which is a separate field on a matter.
 */
export const CaseNumber = Schema.String.pipe(
  Schema.pattern(/^OKL-\d{4}-\d{3}$/),
  Schema.brand("CaseNumber"),
  Schema.annotations({
    identifier: "CaseNumber",
    description: "Firm matter reference, e.g. OKL-2026-014",
  }),
);
export type CaseNumber = typeof CaseNumber.Type;

/**
 * A KRA Personal Identification Number: one letter, nine digits, one letter.
 *
 * `A` leads for individuals, `P` for entities. Shape only — see
 * docs/domain-notes.md §4.1: no checksum has been verified against a KRA
 * specification, so the trailing letter is treated as opaque. Validating a
 * checksum we invented would reject real PINs, which is worse than accepting
 * a malformed one.
 */
export const KraPin = Schema.String.pipe(
  Schema.pattern(/^[AP]\d{9}[A-Z]$/),
  Schema.brand("KraPin"),
  Schema.annotations({
    identifier: "KraPin",
    description: "Kenyan tax PIN: A or P, nine digits, a checkletter",
  }),
);
export type KraPin = typeof KraPin.Type;

/** Whether a PIN belongs to an individual (`A`) or a non-individual (`P`). */
export const kraPinHolder = (pin: KraPin): "individual" | "entity" =>
  pin.startsWith("A") ? "individual" : "entity";

/**
 * A Kenyan telephone number in E.164 form, e.g. `+254722445109`.
 *
 * Nine significant digits after the country code, which is what both mobile and
 * fixed-line numbers carry: `+254 722 445 109` is a mobile, `+254 20 445 3021`
 * is a Nairobi landline. The national trunk `0` never appears in E.164, so the
 * first digit is 1–9.
 *
 * This accepted mobile prefixes only until the seed import ran into it. A firm
 * genuinely does hold a switchboard number for a corporate client, and a type
 * that cannot represent one forces the number to be falsified or dropped —
 * which is a worse outcome than accepting a shape this module cannot fully
 * verify. See domain-notes §4.2, still ⚠️: shorter legacy fixed-line numbers in
 * smaller exchanges are **not** covered, and no source has been checked for
 * them.
 */
export const KenyanPhone = Schema.String.pipe(
  Schema.pattern(/^\+254[1-9]\d{8}$/),
  Schema.brand("KenyanPhone"),
  Schema.annotations({
    identifier: "KenyanPhone",
    description: "Kenyan number in E.164 form, e.g. +254722445109",
  }),
);
export type KenyanPhone = typeof KenyanPhone.Type;

/**
 * Whether a number can receive an SMS.
 *
 * Mobile ranges begin 7 or 1; everything else in the plan is a fixed line. The
 * distinction is not decorative — Phase 7 sends hearing reminders by SMS, and
 * texting a company's switchboard is a reminder nobody receives.
 *
 * Shape-based and no more, on the same footing as the schema above: it says
 * which range a number falls in, never which operator holds it, because
 * portability makes that unknowable from the prefix.
 */
export const phoneKind = (phone: KenyanPhone): "mobile" | "fixed line" =>
  /^\+254[17]/.test(phone) ? "mobile" : "fixed line";

/**
 * Accepts the shapes people actually type — `0722 445 109`, `254722445109`,
 * `+254 722 445 109` — and normalises to E.164 before validating.
 *
 * Kept separate from `KenyanPhone` on purpose: the stored form is canonical,
 * and leniency belongs at the input boundary rather than in the type that the
 * rest of the system relies on.
 */
export const normalisePhone = (input: string): string => {
  const digits = input.replace(/[\s-()]/g, "");
  if (digits.startsWith("+254")) return digits;
  if (digits.startsWith("254")) return `+${digits}`;
  if (digits.startsWith("0")) return `+254${digits.slice(1)}`;
  return digits;
};
