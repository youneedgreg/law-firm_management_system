import { describe, expect, it } from "@effect/vitest";
import { Either } from "effect";
import {
  asFinance,
  asPartner,
  asReceptionist,
  asWanjiku,
  asZenith,
} from "../../../test/fixtures";
import { ROLES } from "../firm/advocate";
import {
  authorize,
  may,
  PERMISSIONS,
  permissionsOf,
  type Permission,
} from "./permissions";
import { includes, OneClient, scopeOf, WholeFirm } from "./principal";

/**
 * The permission table, asserted against on purpose.
 *
 * A table of data is the easiest thing in a codebase to change by accident and
 * the hardest to notice: nothing fails to compile when a role quietly gains
 * `invoice:write`, and nothing looks wrong on a screen. These tests are what
 * makes such a change deliberate — a grant that moves has to be justified in a
 * diff that also edits an assertion saying it does not exist.
 *
 * They are written as *absences* wherever the absence is the interesting fact.
 * "A Receptionist may read the caseload" is a small claim; "a Receptionist may
 * not see a single figure of the firm's money" is the one that matters, and it
 * is the one that would be silently lost.
 */

describe("what each role may do", () => {
  it("gives a Managing Partner everything except moving client money", () => {
    for (const permission of PERMISSIONS) {
      expect(may(asPartner, permission)).toBe(permission !== "trust:write");
    }
  });

  /**
   * Nobody holds `trust:write`, and that is not an oversight.
   *
   * Client money moves by settling a fee note against the ledger —
   * `InvoiceRepository.settleFromTrust`, one payment and one withdrawal in one
   * transaction — and there is no operation that simply takes money out. A
   * permission granted before an operation exists is a claim the system does
   * not honour, so the grant waits for Phase 7's write path.
   */
  it("gives nobody a free hand over the client account", () => {
    const holders = [asPartner, asFinance, asReceptionist, asWanjiku].filter(
      (principal) => may(principal, "trust:write"),
    );

    expect(holders).toEqual([]);
  });

  it("keeps a Finance Officer out of a matter's lifecycle", () => {
    expect(may(asFinance, "invoice:read")).toBe(true);
    expect(may(asFinance, "invoice:write")).toBe(true);
    expect(may(asFinance, "trust:read")).toBe(true);

    // Reading a matter is part of chasing an unpaid fee note. Moving one
    // through its stages is legal work.
    expect(may(asFinance, "case:read")).toBe(true);
    expect(may(asFinance, "case:open")).toBe(false);
    expect(may(asFinance, "case:amend")).toBe(false);
    expect(may(asFinance, "case:transition")).toBe(false);
  });

  it("keeps a Receptionist away from every figure", () => {
    expect(may(asReceptionist, "case:read")).toBe(true);
    expect(may(asReceptionist, "client:read")).toBe(true);

    expect(may(asReceptionist, "invoice:read")).toBe(false);
    expect(may(asReceptionist, "trust:read")).toBe(false);
    expect(may(asReceptionist, "audit:read")).toBe(false);
  });

  /**
   * The administrator is not a superuser, deliberately.
   *
   * They manage logins and read the audit trail. They are not an advocate, so
   * they do not file; they are not a finance officer, so they do not touch the
   * money. An administrator account that can do everything is the single most
   * valuable thing for an attacker to take, and this is the phase to decide it
   * cannot be.
   */
  it("does not make the System Administrator a superuser", () => {
    const admin = { ...asPartner, role: "System Administrator" as const };

    expect(may(admin, "audit:read")).toBe(true);
    expect(may(admin, "case:read")).toBe(true);

    expect(may(admin, "case:open")).toBe(false);
    expect(may(admin, "invoice:read")).toBe(false);
    expect(may(admin, "invoice:write")).toBe(false);
    expect(may(admin, "trust:read")).toBe(false);
  });

  it("gives a portal user three reads and nothing else", () => {
    expect(permissionsOf(asWanjiku)).toEqual([
      "case:read",
      "client:read",
      "invoice:read",
    ]);

    // The reads they do not have are the point: the client account is the
    // firm's ledger and not theirs, the audit trail names other people, and
    // the staff list is the firm's internal directory.
    for (const denied of [
      "case:open",
      "case:amend",
      "case:transition",
      "client:write",
      "invoice:write",
      "trust:read",
      "trust:write",
      "staff:read",
      "audit:read",
    ] as const) {
      expect(may(asWanjiku, denied)).toBe(false);
    }
  });

  /** Every role has an entry, so a role added to the union cannot be missed. */
  it("answers for every role in the union", () => {
    for (const role of ROLES) {
      const staff = { ...asPartner, role };
      expect(permissionsOf(staff).length).toBeGreaterThan(0);
    }
  });
});

describe("refusing", () => {
  it("names the role and the permission, and no more than that", () => {
    const refused = authorize(asReceptionist, "invoice:read");

    expect(Either.isLeft(refused)).toBe(true);
    if (Either.isLeft(refused)) {
      expect(refused.left.role).toBe("Receptionist");
      expect(refused.left.permission).toBe("invoice:read");
      expect(refused.left.reason).toBe("A Receptionist may not invoice read");
    }
  });

  it("hands back the principal when the permission is held", () => {
    const allowed = authorize(asPartner, "case:open");

    expect(Either.isRight(allowed)).toBe(true);
    if (Either.isRight(allowed)) expect(allowed.right).toBe(asPartner);
  });

  it("calls a portal user by a name that is not a staff role", () => {
    const refused = authorize(asWanjiku, "case:open");

    if (Either.isLeft(refused)) {
      expect(refused.left.role).toBe("Client Portal User");
    }
  });
});

describe("scope", () => {
  it("puts staff over the whole firm", () => {
    expect(scopeOf(asPartner)).toStrictEqual(WholeFirm.make({}));
  });

  it("puts a portal user over exactly one client", () => {
    expect(scopeOf(asWanjiku)).toStrictEqual(
      OneClient.make({ clientId: asWanjiku.clientId }),
    );
  });

  /**
   * The two halves of an authorization decision, and why both are needed.
   *
   * A portal user holds `case:read` — the same permission the managing partner
   * uses to read the caseload. The permission is not what protects the other
   * five clients; the scope is. A test that only checked `may` would report
   * this system as wide open, and one that only checked scope would miss that a
   * portal user cannot open a matter for themselves.
   */
  it("is what stops a permission a portal user genuinely holds", () => {
    const scope = scopeOf(asWanjiku);

    expect(may(asWanjiku, "case:read")).toBe(true);
    expect(includes(scope, asWanjiku.clientId)).toBe(true);
    expect(includes(scope, asZenith.clientId)).toBe(false);
  });

  it("lets staff see every client", () => {
    expect(includes(scopeOf(asPartner), asWanjiku.clientId)).toBe(true);
  });
});

/** Every permission the table hands out is one the union declares. */
describe("the table itself", () => {
  it("grants nothing that is not a declared permission", () => {
    const declared = new Set<string>(PERMISSIONS);

    for (const principal of [asPartner, asFinance, asReceptionist, asWanjiku]) {
      for (const permission of permissionsOf(principal)) {
        expect(declared.has(permission satisfies Permission)).toBe(true);
      }
    }
  });
});
