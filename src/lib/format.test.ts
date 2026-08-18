import { describe, expect, it } from "vitest";
import { displayDate, displayTime, hoursBetween, kes } from "./format";

/**
 * These cover the malformed-input paths that `noUncheckedIndexedAccess`
 * surfaced: every one of these functions splits a string and indexes the
 * result, so a value the UI never produces today still has to be survivable.
 */

describe("displayTime", () => {
  it("renders morning and afternoon times in 12-hour form", () => {
    expect(displayTime("09:05")).toBe("9:05 AM");
    expect(displayTime("14:30")).toBe("2:30 PM");
  });

  it("treats midnight and noon as 12, not 0", () => {
    expect(displayTime("00:15")).toBe("12:15 AM");
    expect(displayTime("12:00")).toBe("12:00 PM");
  });

  it("returns the input untouched when it is not a time", () => {
    expect(displayTime("14")).toBe("14");
    expect(displayTime("")).toBe("");
    expect(displayTime("half past two")).toBe("half past two");
  });
});

describe("hoursBetween", () => {
  it("measures a span to the quarter hour", () => {
    expect(hoursBetween("09:00", "11:30")).toBe(2.5);
    expect(hoursBetween("09:00", "09:20")).toBe(0.25);
  });

  it("is zero when the span is backwards or empty", () => {
    expect(hoursBetween("11:00", "09:00")).toBe(0);
    expect(hoursBetween("09:00", "09:00")).toBe(0);
  });

  it("is zero when either end is malformed", () => {
    expect(hoursBetween("09", "11:30")).toBe(0);
    expect(hoursBetween("09:00", "")).toBe(0);
  });
});

describe("displayDate", () => {
  it("renders an ISO date the way the diary writes it", () => {
    expect(displayDate("2026-08-19")).toBe("19 Aug 2026");
  });

  it("returns the input untouched when it is not a date", () => {
    expect(displayDate("2026-08")).toBe("2026-08");
    expect(displayDate("")).toBe("");
  });
});

describe("kes", () => {
  it("formats amounts with thousands separators", () => {
    expect(kes(1_150_000)).toContain("1,150,000");
    expect(kes(0)).toContain("0");
  });
});
