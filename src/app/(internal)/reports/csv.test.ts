import { describe, expect, it } from "vitest";
import { day, money, percent, toCsv } from "./csv";

/**
 * CSV escaping, which is one rule that everybody gets wrong once.
 *
 * A field containing a comma and no quoting shifts every column to its right —
 * producing a corrupt file that opens cleanly, which is worse than one that
 * fails. And the formula-injection guard below is a real vulnerability with a
 * name, not a nicety.
 */

describe("escaping", () => {
  it("leaves an ordinary field alone", () => {
    expect(toCsv([["Wanjiku Mwangi", "12500.00"]])).toBe(
      "Wanjiku Mwangi,12500.00\r\n",
    );
  });

  /** The one that shifts every column to its right. */
  it("quotes a field containing a comma", () => {
    expect(toCsv([["Zenith Distributors, Ltd"]])).toBe(
      '"Zenith Distributors, Ltd"\r\n',
    );
  });

  it("doubles a quotation mark inside a quoted field", () => {
    expect(toCsv([['He said "no"']])).toBe('"He said ""no"""\r\n');
  });

  it("quotes a field containing a newline", () => {
    expect(toCsv([["Line one\nLine two"]])).toBe('"Line one\nLine two"\r\n');
  });

  /**
   * **The security one.**
   *
   * Excel and Sheets treat a field beginning `=`, `+`, `-` or `@` as a formula.
   * A client named `=cmd|'/c calc'!A0` — or simply one whose name starts with a
   * minus — becomes code execution on whoever opens the export. The leading
   * apostrophe is what stops it.
   */
  it("defuses a field that a spreadsheet would run as a formula", () => {
    expect(toCsv([["=1+1"]])).toBe("'=1+1\r\n");
    expect(toCsv([["@SUM(A1:A9)"]])).toBe("'@SUM(A1:A9)\r\n");
    expect(toCsv([["+41722000000"]])).toBe("'+41722000000\r\n");
    expect(toCsv([["-500"]])).toBe("'-500\r\n");
  });

  /** And a guarded field that also needs quoting gets both. */
  it("guards and quotes together", () => {
    expect(toCsv([["=A1,B2"]])).toBe(`"'=A1,B2"\r\n`);
  });

  it("separates rows with CRLF and ends the file with one", () => {
    expect(toCsv([["a"], ["b"]])).toBe("a\r\nb\r\n");
  });
});

describe("values a spreadsheet has to be able to use", () => {
  /**
   * No symbol and no thousands separator: a spreadsheet has to *add* this
   * column, and `KES 12,500.00` is text to every one of them.
   */
  it("writes money as a plain decimal", () => {
    expect(money(12_500_00)).toBe("12500.00");
    expect(money(0)).toBe("0.00");
    expect(money(1)).toBe("0.01");
  });

  it("does not lose the cents on a round figure", () => {
    expect(money(100_000_00)).toBe("100000.00");
  });

  /** ISO, so it sorts and parses the same way everywhere. */
  it("writes dates as YYYY-MM-DD", () => {
    expect(day(new Date("2026-08-21T09:00:00.000Z"))).toBe("2026-08-21");
  });

  it("writes a share as a number rather than a string with a percent sign", () => {
    expect(percent(0.784)).toBe("78.4");
    expect(percent(0)).toBe("0.0");
    expect(percent(1)).toBe("100.0");
  });
});
