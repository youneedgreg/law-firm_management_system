import { describe, expect, it } from "@effect/vitest";
import { Either } from "effect";
import {
  asAdvocate,
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
  it("gives a Managing Partner everything", () => {
    for (const permission of PERMISSIONS) {
      expect(may(asPartner, permission)).toBe(true);
    }
  });

  /**
   * `trust:write` is held by two roles, and the interesting one is who is left
   * out.
   *
   * It was held by nobody through Phase 6, because nothing could move client
   * money and a permission granted before an operation exists is a claim the
   * system does not honour. Phase 7 built the operations — a deposit, and a
   * Rule 9 transfer to office account — so the grant moved, and this assertion
   * moved with it, which is the point of writing it down.
   *
   * An **ordinary Advocate does not hold it**. That is a deliberate separation
   * of duties rather than an omission: the fee-earner who raises a fee note
   * cannot also pay it out of their own client's money. It is the entry to
   * argue with if anyone is going to argue with this table, so it gets its own
   * assertion rather than being one of six in a loop.
   */
  it("lets only finance and the partner move client money", () => {
    const holders = [
      asPartner,
      asAdvocate,
      asFinance,
      asReceptionist,
      asWanjiku,
    ].filter((principal) => may(principal, "trust:write"));

    expect(holders).toEqual([asPartner, asFinance]);
  });

  it("does not let the advocate who raised a fee note settle it from trust", () => {
    // Reading the ledger is part of advising a client about their own money.
    expect(may(asAdvocate, "trust:read")).toBe(true);
    expect(may(asAdvocate, "trust:write")).toBe(false);
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

  /**
   * A Receptionist reads work and does not raise it.
   *
   * The same shape as the diary: they answer the telephone about what is
   * happening, and carrying out a task somebody assigned is not the same as
   * deciding it needs doing. The read is what makes the front desk able to say
   * "that is with Mercy, due Thursday" instead of taking a message.
   */
  it("lets a Receptionist read work without raising it", () => {
    expect(may(asReceptionist, "task:read")).toBe(true);
    expect(may(asReceptionist, "task:write")).toBe(false);
  });

  /**
   * Finance holds both halves of `task`, and only the read half of `time`.
   *
   * The asymmetry is the interesting part and it is about who performs the act.
   * Recording time is the fee-earner's own; reconciling the trust account is
   * finance's own, and it is the prototype's one task with no matter behind it.
   */
  it("lets a Finance Officer raise work but not record time", () => {
    expect(may(asFinance, "task:write")).toBe(true);
    expect(may(asFinance, "time:read")).toBe(true);
    expect(may(asFinance, "time:write")).toBe(false);
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

  /**
   * Four reads and one write, and the write is the interesting entry.
   *
   * `document:read` arrived first: a client is entitled to the documents on
   * their own file, which is what a portal is for, and the scope keeps them to
   * their own.
   *
   * **`message:write` is the portal's only write, ever.** A client portal whose
   * client cannot write is a notice board, and refusing it pushes the
   * conversation back onto email — unencrypted, unattributed, outside every
   * guarantee this system makes.
   *
   * The asymmetry with `document:write` is the argument for both. A message
   * needs no quarantine: it is text landing in a thread the firm reads, and
   * nothing else acts on it. A document enters the matter *file* — the thing
   * that gets filed at court and relied on — and a file anybody may add to
   * needs a review step and a decision about what happens to a document the
   * firm did not put there. So one is granted and the other is not, and this
   * assertion is where that has to be argued rather than assumed.
   */
  it("gives a portal user four reads and exactly one write", () => {
    expect(permissionsOf(asWanjiku)).toEqual([
      "case:read",
      "client:read",
      "invoice:read",
      "document:read",
      "message:read",
      "message:write",
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
      "time:read",
      "time:write",
      "hearing:read",
      "hearing:write",
      /**
       * The one they conspicuously do not have, beside the one they do. A
       * client may send a *message* about a document and may not put a
       * document on the file.
       */
      "document:write",
      /**
       * The firm's own work list, which is internal by definition. It names
       * who is doing what and by when across every matter — a client seeing it
       * would see other clients' deadlines, and a client seeing only their own
       * would still be reading the firm's internal allocation of staff.
       */
      "task:read",
      "task:write",
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
