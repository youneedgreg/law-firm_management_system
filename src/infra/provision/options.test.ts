import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { ROLES } from "../../domain/firm/advocate";
import { parse } from "./options";

/**
 * The arguments to the program that writes a firm's first login (D-13).
 *
 * Every mistake this program can make is made here rather than in the two
 * inserts, which is why the parsing is a pure function with its own tests: a
 * misspelt role or an address with a space in it should be a sentence on a
 * terminal, before anything opens a connection to a database holding a law
 * firm's records.
 */

const args = (options: Record<string, string>) =>
  Object.entries(options).flatMap(([flag, value]) => [`--${flag}`, value]);

const valid = {
  name: "Grace Kimani",
  email: "grace@kimani-otieno.co.ke",
  role: "Managing Partner",
};

const parseWith = (options: Record<string, string>) => parse(args(options));

describe("provisioning arguments", () => {
  it("reads a name, an address and a role", () => {
    const request = parseWith(valid);

    expect(Either.isRight(request)).toBe(true);
    if (Either.isRight(request)) {
      expect(request.right.name).toBe("Grace Kimani");
      expect(request.right.email).toBe("grace@kimani-otieno.co.ke");
      expect(request.right.role).toBe("Managing Partner");
      expect(request.right.certificate).toBeUndefined();
    }
  });

  it.each(["name", "email", "role"] as const)("requires --%s", (flag) => {
    const rest: Record<string, string> = { ...valid };
    delete rest[flag];

    const request = parseWith(rest);

    expect(Either.isLeft(request)).toBe(true);
    if (Either.isLeft(request)) expect(request.left).toContain(flag);
  });

  /**
   * Whitespace is not a name. `advocates.name` carries
   * `CHECK (btrim(name) <> '')`, and a value that passes here and fails there
   * is a constraint violation in place of a sentence.
   */
  it("does not accept a name of spaces", () => {
    expect(Either.isLeft(parseWith({ ...valid, name: "   " }))).toBe(true);
  });

  it("refuses something that is not an address", () => {
    for (const email of ["grace", "grace@", "two words@example.com"]) {
      expect(Either.isLeft(parseWith({ ...valid, email }))).toBe(true);
    }
  });

  /**
   * Every role in the domain is accepted, read from `ROLES` rather than listed
   * again. A role added there is offered here without anybody remembering to
   * come back, and this test is what would notice if that stopped being true.
   */
  it.each(ROLES)("accepts %s", (role) => {
    expect(Either.isRight(parseWith({ ...valid, role }))).toBe(true);
  });

  /**
   * The refusal carries the alternatives. The person reading it is at a
   * terminal and the next thing they need is the spelling — "invalid role"
   * would send them to the source to find it.
   */
  it("refuses a role that is not one, and says what the roles are", () => {
    const request = parseWith({ ...valid, role: "managing partner" });

    expect(Either.isLeft(request)).toBe(true);
    if (Either.isLeft(request)) {
      expect(request.left).toContain("Managing Partner");
      expect(request.left).toContain("Receptionist");
    }
  });

  it("takes a practising certificate when it is given one", () => {
    const request = parseWith({
      ...valid,
      certificate: "P.105/2026",
      "certificate-year": "2026",
    });

    expect(Either.isRight(request)).toBe(true);
    if (Either.isRight(request)) {
      expect(request.right.certificate).toEqual({
        number: "P.105/2026",
        year: 2026,
      });
    }
  });

  /**
   * Half a certificate is refused, mirroring `certificate_complete` in
   * migration 0001. The database's reasoning is that half a certificate cannot
   * be reasoned about; the point of repeating it here is that the operator
   * finds out before anything is written, not after.
   */
  it.each([{ certificate: "P.105/2026" }, { "certificate-year": "2026" }])(
    "refuses half a certificate: %o",
    (half) => {
      expect(Either.isLeft(parseWith({ ...valid, ...half }))).toBe(true);
    },
  );

  it("refuses a certificate year that is not a year", () => {
    for (const year of ["1999", "2101", "twenty-six", "2026.5"]) {
      const request = parseWith({
        ...valid,
        certificate: "P.105/2026",
        "certificate-year": year,
      });
      expect(Either.isLeft(request)).toBe(true);
    }
  });

  /**
   * An unknown flag is refused rather than ignored. `--rôle` typed by somebody
   * whose keyboard did that, or `--certificate-number` guessed from the column
   * name, must not silently produce an account with a different role or no
   * certificate.
   */
  it("refuses a flag it does not know", () => {
    expect(
      Either.isLeft(parseWith({ ...valid, "certificate-number": "P.105" })),
    ).toBe(true);
  });
});
