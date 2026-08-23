import { parseArgs } from "node:util";
import { Either, Schema } from "effect";
import { Advocate, ROLES, type Role } from "../../domain/firm/advocate";

/**
 * What `npm run provision:admin` was asked to create (D-13).
 *
 * Parsing is separated from doing for the usual reason and one specific one:
 * this is the program that writes the first login on a firm's installation, and
 * every mistake it can make is made here, in the arguments, rather than in the
 * two `INSERT`s. A misspelt role, an address with a space in it, a name that is
 * only whitespace — all of them are refusable before anything opens a
 * connection, and all of them are testable without one.
 */

export interface AdminRequest {
  readonly name: string;
  readonly email: string;
  readonly role: Role;
  /**
   * A practising certificate, or none.
   *
   * Optional because most staff do not hold one — a Legal Assistant never does
   * — and both halves together because `certificate_complete` in migration
   * 0001 refuses half of one. The database's reasoning is that half a
   * certificate cannot be reasoned about; this mirrors it so the refusal
   * arrives as a sentence rather than as a constraint violation.
   */
  readonly certificate?: { readonly number: string; readonly year: number };
}

export const USAGE = `
Usage:
  npm run provision:admin -- --name "Grace Kimani" \\
                             --email grace@kimani-otieno.co.ke \\
                             --role "Managing Partner" \\
                             [--certificate P.105/2026 --certificate-year 2026]

The password is asked for on the terminal. Set ADMIN_PASSWORD instead only when
there is no terminal to ask on; it is visible to \`ps\` and lands in shell
history, which a password for a system holding privileged material should not.

Roles: ${ROLES.join(", ")}
`.trim();

/**
 * The email rule, taken from the domain rather than restated.
 *
 * `Advocate` already carries the pattern, and migration 0001 carries the same
 * one as a `CHECK`. A third copy here would be the one that drifts, and the
 * symptom would be an address this accepts and the database refuses — after
 * the advocate row is written and before the login is.
 */
const Email = Advocate.fields.email;

const missing = (flag: string) => `--${flag} is required`;

const trimmed = (value: string | undefined): string => value?.trim() ?? "";

/**
 * Reads the arguments, or says what is wrong with them.
 *
 * A `string` failure rather than a tagged error: the only caller prints it and
 * exits, and there is no branch anywhere that would want to tell one kind of
 * bad argument from another.
 */
export const parse = (
  argv: readonly string[],
): Either.Either<AdminRequest, string> => {
  let parsed;

  try {
    parsed = parseArgs({
      args: [...argv],
      options: {
        name: { type: "string" },
        email: { type: "string" },
        role: { type: "string" },
        certificate: { type: "string" },
        "certificate-year": { type: "string" },
      },
      strict: true,
      allowPositionals: false,
    });
  } catch (failure) {
    return Either.left(
      failure instanceof Error ? failure.message : String(failure),
    );
  }

  const { values } = parsed;

  const name = trimmed(values.name);
  const email = trimmed(values.email);
  const role = trimmed(values.role);

  if (name === "") return Either.left(missing("name"));
  if (email === "") return Either.left(missing("email"));
  if (role === "") return Either.left(missing("role"));

  if (!Schema.is(Email)(email)) {
    return Either.left(`${email} is not an email address`);
  }

  /**
   * The role is checked against the domain's own list, so a role added to
   * `ROLES` is offered here without anybody remembering — and a typo is
   * refused with the alternatives rather than with "invalid role", because the
   * person reading this is at a terminal and the next thing they need is the
   * spelling.
   */
  if (!(ROLES as readonly string[]).includes(role)) {
    return Either.left(`"${role}" is not a role. One of: ${ROLES.join(", ")}`);
  }

  const certificateNumber = trimmed(values.certificate);
  const certificateYear = trimmed(values["certificate-year"]);

  if (certificateNumber === "" && certificateYear === "") {
    return Either.right({ name, email, role: role as Role });
  }

  if (certificateNumber === "" || certificateYear === "") {
    return Either.left(
      "--certificate and --certificate-year go together, or neither does",
    );
  }

  const year = Number(certificateYear);

  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return Either.left(
      `--certificate-year must be a year between 2000 and 2100, not "${certificateYear}"`,
    );
  }

  return Either.right({
    name,
    email,
    role: role as Role,
    certificate: { number: certificateNumber, year },
  });
};
