import { describe, expect, it } from "vitest";
import * as Throttle from "./throttle";

/**
 * The rate-limit policy, as data.
 *
 * The tests here look almost too simple to be worth writing, and the second one
 * is the reason they are: **no counter may be keyed on an account alone.** That
 * is not an implementation detail, it is the property that separates a rate
 * limit from a remote control for locking advocates out of their own files. It
 * is also a property that a well-meaning change — "surely we should also limit
 * per account?" — would remove without anything else failing.
 */

const SOURCE = "203.0.113.7";

describe("what a sign-in spends from", () => {
  it("counts the source and the account together, and the source alone", () => {
    const allowances = Throttle.forSignIn(SOURCE, "swanjiru@oklaw.co.ke");

    expect(allowances).toHaveLength(2);
    expect(allowances.map((allowance) => allowance.attempts)).toEqual([5, 20]);
  });

  /**
   * Every advocate's address is on the firm's website. A counter keyed on the
   * address alone would let anybody who can read it lock a partner out on the
   * morning of a hearing, five wrong passwords at a time — a denial of service
   * delivered by the safeguard.
   */
  it("keys every counter on the source, so no account can be locked out", () => {
    const allowances = Throttle.forSignIn(SOURCE, "swanjiru@oklaw.co.ke");

    for (const allowance of allowances) {
      expect(allowance.bucket).toContain(SOURCE);
    }
  });

  /** Two connections cannot exhaust each other's attempts. */
  it("gives two sources separate counters for the same account", () => {
    const office = Throttle.forSignIn("198.51.100.4", "swanjiru@oklaw.co.ke");
    const elsewhere = Throttle.forSignIn(SOURCE, "swanjiru@oklaw.co.ke");

    expect(office.map((a) => a.bucket)).not.toEqual(
      elsewhere.map((a) => a.bucket),
    );
  });

  /**
   * Sign-in compares addresses case-insensitively, so a counter that did not
   * would be a limiter defeated by pressing shift.
   */
  it("does not care how the address was capitalised", () => {
    expect(Throttle.forSignIn(SOURCE, "SWanjiru@OKLaw.co.ke ")).toEqual(
      Throttle.forSignIn(SOURCE, "swanjiru@oklaw.co.ke"),
    );
  });

  /** The narrow bucket must be narrower, or the wide one never fires first. */
  it("allows fewer attempts against one account than across many", () => {
    const [account, source] = Throttle.forSignIn(SOURCE, "a@oklaw.co.ke");

    expect(account?.attempts).toBeLessThan(source?.attempts ?? 0);
  });
});

describe("what a password reset spends from", () => {
  /**
   * Tighter than a sign-in, because the endpoint is an amplifier: each request
   * is a message sent to somebody who did not ask for it, so the cost of an
   * unthrottled one falls on the person being harassed.
   */
  it("is tighter than a sign-in, and keyed only on the source", () => {
    const [reset] = Throttle.forReset(SOURCE);
    const [, signIn] = Throttle.forSignIn(SOURCE, "a@oklaw.co.ke");

    expect(reset?.bucket).toContain(SOURCE);
    expect(reset?.attempts).toBeLessThan(signIn?.attempts ?? 0);
  });

  /** And is a different counter, so one cannot be spent through the other. */
  it("does not share a counter with sign-in", () => {
    const [reset] = Throttle.forReset(SOURCE);
    const [, signIn] = Throttle.forSignIn(SOURCE, "a@oklaw.co.ke");

    expect(reset?.bucket).not.toBe(signIn?.bucket);
  });
});

describe("the refusal", () => {
  /**
   * It says how long to wait and nothing else. A remaining-attempts count would
   * be a progress meter for whatever is being throttled, and naming the bucket
   * that ran out would say whether the address exists.
   */
  it("says when to come back, and nothing about why it ran out", () => {
    const refusal = Throttle.refuse();

    expect(refusal.minutes).toBe(15);
    expect(refusal.reason).toContain("15 minutes");
    expect(refusal.reason).not.toContain("bucket");
  });
});
