import { Schema } from "effect";
import { AdvocateId } from "../shared/ids";

/**
 * People at the firm, and what each is permitted to do.
 *
 * The distinction that matters legally: only an advocate holding a current
 * practising certificate may appear in court or sign court documents. A
 * paralegal may do most of the work on a matter and none of that. So
 * `practisingCertificate` is not a decorative field — `mayAppearInCourt`
 * depends on it, and Phase 6's authorization rules will too.
 */

export const ROLES = [
  "System Administrator",
  "Managing Partner",
  "Advocate",
  "Legal Assistant",
  "Finance Officer",
  "Receptionist",
] as const;

export const Role = Schema.Literal(...ROLES);
export type Role = typeof Role.Type;

/**
 * A practising certificate, which is issued for a calendar year and must be
 * renewed. Holding one last year is not holding one now.
 */
export const PractisingCertificate = Schema.Struct({
  number: Schema.NonEmptyTrimmedString,
  /** The year the certificate is valid for. */
  year: Schema.Int.pipe(Schema.between(2000, 2100)),
});

export type PractisingCertificate = typeof PractisingCertificate.Type;

export const Advocate = Schema.Struct({
  id: AdvocateId,
  name: Schema.NonEmptyTrimmedString,
  role: Role,
  email: Schema.String.pipe(Schema.pattern(/^[^@\s]+@[^@\s]+$/)),
  /** Absent for staff who are not advocates at all. */
  practisingCertificate: Schema.optional(PractisingCertificate),
  /** When they were admitted to the bar, for advocates. */
  admittedOn: Schema.optional(Schema.DateFromSelf),
  active: Schema.Boolean,
});

export type Advocate = typeof Advocate.Type;

/**
 * Whether this person may appear in court on the given date.
 *
 * Requires an active staff record, a role that appears, and a certificate for
 * the year in question. The year check is why `asAt` is a parameter: a
 * certificate valid in 2026 says nothing about an appearance listed for
 * January 2027, and that is exactly the kind of lapse a firm discovers on the
 * morning of the hearing.
 */
export const mayAppearInCourt = (advocate: Advocate, asAt: Date): boolean => {
  if (!advocate.active) return false;
  if (advocate.role !== "Advocate" && advocate.role !== "Managing Partner") {
    return false;
  }
  return advocate.practisingCertificate?.year === asAt.getUTCFullYear();
};

/** Staff whose certificate does not cover the given year. */
export const certificateLapsed = (
  advocates: readonly Advocate[],
  asAt: Date,
): readonly Advocate[] =>
  advocates.filter(
    (advocate) =>
      advocate.active &&
      (advocate.role === "Advocate" || advocate.role === "Managing Partner") &&
      !mayAppearInCourt(advocate, asAt),
  );
