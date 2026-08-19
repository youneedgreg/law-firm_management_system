import { Either, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { CalendarDate, Cents, formatCalendarDate } from "./columns";

/**
 * The two column types where the driver's representation and the domain's
 * disagree. Both are the sort of conversion that looks like a one-liner and is
 * wrong in a way nothing notices for months, so both are attacked rather than
 * demonstrated.
 */

const decodeCents = Schema.decodeUnknownEither(Cents);
const decodeDate = Schema.decodeUnknownEither(CalendarDate);

describe("Cents", () => {
  it("accepts the string node-postgres returns for a bigint", () => {
    expect(decodeCents("20000000")).toStrictEqual(Either.right(20_000_000));
  });

  it("accepts a number, because not every driver agrees", () => {
    expect(decodeCents(20_000_000)).toStrictEqual(Either.right(20_000_000));
  });

  it("accepts a negative balance, which a trust view can legitimately hold", () => {
    expect(decodeCents("-5000")).toStrictEqual(Either.right(-5000));
  });

  /**
   * `Number("")` is 0 and `Number("1e3")` is 1000. Both are integers by the
   * time `Number.isInteger` sees them, which is why the check is on the text.
   */
  it.each(["", " ", "1e3", "12.5", "0x10", "NaN", "abc"])(
    "refuses %o rather than coercing it",
    (input) => {
      expect(Either.isLeft(decodeCents(input))).toBe(true);
    },
  );

  it("refuses a value too large to hold exactly", () => {
    expect(Either.isLeft(decodeCents("9007199254740993"))).toBe(true);
  });

  it("refuses a fractional number", () => {
    expect(Either.isLeft(decodeCents(12.5))).toBe(true);
  });
});

describe("CalendarDate", () => {
  it("reads the string form Postgres writes", () => {
    expect(decodeDate("2026-08-19")).toStrictEqual(
      Either.right(new Date("2026-08-19T00:00:00.000Z")),
    );
  });

  /**
   * The case this schema exists for. node-postgres parses a `date` into a
   * `Date` at *local* midnight, so in any zone east of UTC the instant falls on
   * the previous day. Reading the local calendar fields recovers the day the
   * database actually holds; reading `getUTCDate` would lose it.
   */
  it("recovers the right day from a driver Date at local midnight", () => {
    const asDriverParsesIt = new Date(2026, 7, 19, 0, 0, 0);

    expect(decodeDate(asDriverParsesIt)).toStrictEqual(
      Either.right(new Date("2026-08-19T00:00:00.000Z")),
    );
  });

  it("round-trips every day of a leap February", () => {
    for (let day = 1; day <= 29; day += 1) {
      const text = `2024-02-${String(day).padStart(2, "0")}`;
      const decoded = Schema.decodeUnknownSync(CalendarDate)(text);
      expect(formatCalendarDate(decoded)).toBe(text);
    }
  });

  it("refuses a day that does not exist rather than rolling it forward", () => {
    // `new Date(Date.UTC(2026, 1, 30))` is 2 March, silently.
    expect(Either.isLeft(decodeDate("2026-02-30"))).toBe(true);
    expect(Either.isLeft(decodeDate("2025-02-29"))).toBe(true);
  });

  it.each(["19-08-2026", "2026-8-19", "2026-08-19T00:00:00Z", "not a date"])(
    "refuses %o",
    (input) => {
      expect(Either.isLeft(decodeDate(input))).toBe(true);
    },
  );

  it("refuses an Invalid Date", () => {
    expect(Either.isLeft(decodeDate(new Date("nonsense")))).toBe(true);
  });

  it("encodes to the unambiguous text form, not an instant", () => {
    expect(
      Schema.encodeSync(CalendarDate)(new Date("2026-08-19T00:00:00.000Z")),
    ).toBe("2026-08-19");
  });
});
