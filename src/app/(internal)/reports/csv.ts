/**
 * CSV, written out rather than reached for from a package.
 *
 * The whole format is one escaping rule and a line ending, and the rule is
 * where every hand-rolled exporter goes wrong: a field containing a comma, a
 * quotation mark or a newline must be quoted, and quotation marks inside it
 * doubled. Get that wrong and a client name like `Zenith Distributors, Ltd`
 * silently shifts every column to its right — a corrupt report that opens
 * cleanly, which is worse than one that fails.
 *
 * ## Why not a library
 *
 * Because the honest alternative is forty lines of dependency for eight lines
 * of code, and because the *interesting* decisions here are not the escaping —
 * they are the ones below about money and dates, which no library can make.
 */

/**
 * One field, escaped.
 *
 * A leading `=`, `+`, `-` or `@` is also prefixed with a quote. That is not
 * part of the format: it is because Excel and Sheets interpret such a field as
 * a *formula*, and a client whose name begins with a minus sign — or an
 * attacker who chose one — gets code execution on whoever opens the file. The
 * defence is cheap and the absence of it is a real vulnerability with a name.
 */
const field = (value: string): string => {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;

  return /["\n\r,]/.test(guarded)
    ? `"${guarded.replaceAll('"', '""')}"`
    : guarded;
};

/**
 * Money as a plain decimal, with no symbol and no thousands separator.
 *
 * `1250000` cents becomes `12500.00`. A spreadsheet has to be able to *add*
 * this column, and `KES 12,500.00` is text to every one of them — which is how
 * an export that looks right produces a total of zero. Formatting is the
 * screen's job; an export is data.
 */
export const money = (cents: number): string => (cents / 100).toFixed(2);

/**
 * Dates as `YYYY-MM-DD`.
 *
 * ISO, not the `en-KE` format the screens use, and for the same reason as the
 * money: a spreadsheet parses this and sorts it correctly, and `21/08/2026` is
 * read as a date by some locales, as text by others, and as 8 September by
 * anyone whose machine is set to American conventions.
 */
export const day = (date: Date): string => date.toISOString().slice(0, 10);

/** A percentage as a number, so it can be averaged. */
export const percent = (share: number): string => (share * 100).toFixed(1);

/**
 * Rows to a CSV document.
 *
 * `\r\n` because RFC 4180 says so and because Excel on Windows still cares.
 * A trailing newline, so the file ends the way every other text file does.
 */
export const toCsv = (rows: readonly (readonly string[])[]): string =>
  `${rows.map((row) => row.map(field).join(",")).join("\r\n")}\r\n`;
