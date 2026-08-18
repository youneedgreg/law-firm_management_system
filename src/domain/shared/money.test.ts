import { Either } from "effect";
import { describe, expect, it } from "vitest";
import * as Money from "./money";

describe("construction", () => {
  it("takes whole cents", () => {
    expect(Money.fromCents(115_000_000)).toBe(115_000_000);
  });

  it("rejects fractional cents rather than rounding them away", () => {
    expect(() => Money.fromCents(10.5)).toThrow(TypeError);
  });

  it("converts shillings that land exactly on a cent", () => {
    expect(Either.getOrThrow(Money.fromShillings(1_150_000))).toBe(115_000_000);
    expect(Either.getOrThrow(Money.fromShillings(0.05))).toBe(5);
  });

  it("refuses shillings finer than a cent", () => {
    const result = Money.fromShillings(0.001);
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("arithmetic", () => {
  const a = Money.fromCents(1000);
  const b = Money.fromCents(250);

  it("adds and subtracts exactly", () => {
    expect(Money.add(a, b)).toBe(1250);
    expect(Money.subtract(a, b)).toBe(750);
  });

  it("permits negative results, which the ledger relies on", () => {
    // Subtraction does not clamp. A trust rule rejecting an overdraw is a
    // domain decision made where the rule lives, not silently here.
    expect(Money.subtract(b, a)).toBe(-750);
    expect(Money.isNegative(Money.subtract(b, a))).toBe(true);
  });

  it("sums a list, and an empty list is zero", () => {
    expect(Money.sum([a, b, b])).toBe(1500);
    expect(Money.sum([])).toBe(0);
  });

  it("does not accumulate float error the way shillings would", () => {
    // 0.1 + 0.2 !== 0.3 in floating point. In cents it is exact.
    const tenCents = Money.fromCents(10);
    const twentyCents = Money.fromCents(20);
    expect(Money.add(tenCents, twentyCents)).toBe(30);

    const hundredth = Money.fromCents(1);
    expect(Money.sum(Array.from({ length: 100 }, () => hundredth))).toBe(100);
  });
});

describe("multiply", () => {
  it("scales by an hour count, landing on a cent", () => {
    const hourlyRate = Money.fromCents(2_500_00);
    expect(Money.multiply(hourlyRate, 2.5)).toBe(6_250_00);
  });

  it("rounds half up to the nearest cent", () => {
    expect(Money.multiply(Money.fromCents(101), 0.5)).toBe(51);
  });
});

describe("allocate", () => {
  it("never loses a cent to rounding", () => {
    const parts = Money.allocate(Money.fromCents(1000), 3);
    expect(parts).toStrictEqual([334, 333, 333]);
    expect(Money.sum(parts)).toBe(1000);
  });

  it("divides evenly when it can", () => {
    expect(Money.allocate(Money.fromCents(900), 3)).toStrictEqual([
      300, 300, 300,
    ]);
  });

  it("keeps the invariant for any split of any amount", () => {
    for (let amount = 0; amount < 200; amount++) {
      for (let parts = 1; parts <= 7; parts++) {
        const split = Money.allocate(Money.fromCents(amount), parts);
        expect(split).toHaveLength(parts);
        expect(Money.sum(split)).toBe(amount);
      }
    }
  });

  it("handles negative amounts without losing a cent either", () => {
    const parts = Money.allocate(Money.fromCents(-1000), 3);
    expect(Money.sum(parts)).toBe(-1000);
  });

  it("rejects a nonsensical number of parts", () => {
    expect(() => Money.allocate(Money.fromCents(100), 0)).toThrow(TypeError);
  });
});

describe("format", () => {
  it("renders shillings and cents", () => {
    const formatted = Money.format(Money.fromCents(115_000_000));
    expect(formatted).toContain("1,150,000.00");
  });
});
