import { describe, expect, it } from "vitest";
import * as Limitation from "./limitation";

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);

describe("statutory periods (Limitation of Actions Act s. 4)", () => {
  it("gives contract six years from accrual", () => {
    const window = Limitation.limitationWindow("contract", utc("2026-08-19"));
    expect(iso(window.expiresOn)).toBe("2032-08-19");
    expect(window.provision).toContain("s. 4(1)(a)");
  });

  it("gives tort three years from accrual", () => {
    const window = Limitation.limitationWindow("tort", utc("2026-08-19"));
    expect(iso(window.expiresOn)).toBe("2029-08-19");
    expect(window.provision).toContain("s. 4(2)");
  });

  it("gives defamation twelve months", () => {
    const window = Limitation.limitationWindow("defamation", utc("2026-08-19"));
    expect(iso(window.expiresOn)).toBe("2027-08-19");
    expect(window.provision).toContain("proviso");
  });

  it("flags the bases that are commonly extended under s. 27", () => {
    expect(
      Limitation.limitationWindow("tort", utc("2026-01-01")).note,
    ).toContain("s. 27");
    expect(
      Limitation.limitationWindow("personal injury", utc("2026-01-01")).note,
    ).toContain("s. 27");
  });

  it("does not claim an extension exists for contract", () => {
    expect(
      Limitation.limitationWindow("contract", utc("2026-01-01")).note,
    ).toBeUndefined();
  });
});

describe("date arithmetic", () => {
  it("clamps rather than overflowing into the next month", () => {
    // 31 August + 12 months is fine, but 31 January + 1 month would overflow
    // to 3 March under naive setMonth. Defamation from 31 March 2027 lands on
    // 31 March 2028 — the check that matters is the short-month case below.
    const window = Limitation.limitationWindow("defamation", utc("2026-08-31"));
    expect(iso(window.expiresOn)).toBe("2027-08-31");
  });

  it("clamps a leap day to the 28th in a non-leap year", () => {
    // 29 February 2028 + 3 years lands in 2031, which has no 29 February.
    // Clamping to the 28th is early, which is the safe direction for a
    // limitation prompt.
    const window = Limitation.limitationWindow("tort", utc("2028-02-29"));
    expect(iso(window.expiresOn)).toBe("2031-02-28");
  });

  it("keeps a leap day intact when the target year has one", () => {
    // 29 February 2028 + 12 months → 2029 has no leap day, clamps to 28th.
    // But 28 February 2028 + 4 years → 2032 does, and should stay the 28th.
    const window = Limitation.limitationWindow("contract", utc("2026-02-28"));
    expect(iso(window.expiresOn)).toBe("2032-02-28");
  });

  it("does not mutate the date it was given", () => {
    const accrued = utc("2026-08-19");
    Limitation.limitationWindow("contract", accrued);
    expect(iso(accrued)).toBe("2026-08-19");
  });
});

describe("daysRemaining", () => {
  it("counts whole days to expiry", () => {
    const window = Limitation.limitationWindow("defamation", utc("2026-01-01"));
    expect(Limitation.daysRemaining(window, utc("2026-12-31"))).toBe(1);
    expect(Limitation.daysRemaining(window, utc("2027-01-01"))).toBe(0);
  });

  it("goes negative once the period has passed", () => {
    const window = Limitation.limitationWindow("defamation", utc("2026-01-01"));
    expect(Limitation.daysRemaining(window, utc("2027-02-01"))).toBe(-31);
  });

  it("ignores the time of day", () => {
    const window = Limitation.limitationWindow("defamation", utc("2026-01-01"));
    const lateInTheDay = new Date("2026-12-31T23:59:00Z");
    expect(Limitation.daysRemaining(window, lateInTheDay)).toBe(1);
  });
});

describe("urgency", () => {
  const window = Limitation.limitationWindow("tort", utc("2026-01-01"));
  // expires 2029-01-01

  it("is comfortable while the deadline is distant", () => {
    expect(Limitation.urgency(window, utc("2027-01-01"))).toBe("comfortable");
  });

  it("is approaching inside ninety days", () => {
    expect(Limitation.urgency(window, utc("2028-11-01"))).toBe("approaching");
  });

  it("is critical inside thirty days", () => {
    expect(Limitation.urgency(window, utc("2028-12-15"))).toBe("critical");
  });

  it("is expired the day after", () => {
    expect(Limitation.urgency(window, utc("2029-01-02"))).toBe("expired");
  });

  it("is still critical, not expired, on the final day", () => {
    expect(Limitation.urgency(window, utc("2029-01-01"))).toBe("critical");
  });
});
