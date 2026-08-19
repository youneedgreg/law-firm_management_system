import { ParseResult, Schema } from "effect";

/**
 * Column schemas for the two Postgres types whose wire representation does not
 * match what the domain wants.
 *
 * Both exist because the driver's default is lossy in a way that only shows up
 * later: `bigint` arrives as a string, and `date` arrives as a `Date` pinned to
 * local midnight. Neither is wrong, and both are easy to paper over with a
 * `Number(…)` or a bare `Date` — which is how a money column silently becomes a
 * float and a filing date silently moves a day.
 */

// ── Money ─────────────────────────────────────────────────────────────────

/**
 * A `bigint` cents column.
 *
 * node-postgres hands `bigint` back as a string rather than a number, because
 * the range exceeds what a JS number can hold exactly. The domain's `Money` is
 * an integer count of cents, so the conversion has to happen somewhere; doing
 * it here means it happens once, and a value that will not survive the round
 * trip is refused rather than rounded.
 *
 * Both shapes are accepted on the way in: PGlite and node-postgres disagree
 * about whether a summed `bigint` comes back as a string, and a schema that
 * only knows one of them fails in whichever environment it was not written in.
 */
export const Cents = Schema.transformOrFail(
  Schema.Union(Schema.String, Schema.Number),
  Schema.Int,
  {
    strict: true,
    decode: (raw, _options, ast) => {
      const value = typeof raw === "number" ? raw : Number(raw);

      // `Number("")` is 0 and `Number("1e3")` is 1000; neither is a cents
      // column, and both would pass a bare `Number.isInteger` check.
      return Number.isSafeInteger(value) && /^-?\d+$/.test(String(raw).trim())
        ? ParseResult.succeed(value)
        : ParseResult.fail(
            new ParseResult.Type(
              ast,
              raw,
              `${JSON.stringify(raw)} is not an exact integer number of cents`,
            ),
          );
    },
    encode: (value) => ParseResult.succeed(value),
  },
).annotations({ identifier: "Cents" });

// ── Calendar dates ────────────────────────────────────────────────────────

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** The `YYYY-MM-DD` a Postgres `date` column round-trips through. */
export const formatCalendarDate = (date: Date): string =>
  `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

/**
 * A Postgres `date` column — a calendar day, with no time and no zone.
 *
 * The awkwardness this contains: node-postgres parses `date` into a `Date` at
 * **local** midnight, so `2026-08-19` in Nairobi is `2026-08-18T21:00:00Z`.
 * Handing that straight back to Postgres re-reads it in the session's zone and
 * can land on the previous day. A filing date that drifts by one day is not a
 * cosmetic bug in this domain — it is the difference between inside and outside
 * a limitation period.
 *
 * So: decoding accepts either the string or the driver's `Date` and normalises
 * to UTC midnight by reading the *local* calendar fields (which is where the
 * driver put the right day). Encoding always emits `YYYY-MM-DD`, which Postgres
 * reads identically in every session zone.
 */
export const CalendarDate = Schema.transformOrFail(
  Schema.Union(Schema.String, Schema.DateFromSelf),
  Schema.ValidDateFromSelf,
  {
    strict: true,
    decode: (raw, _options, ast) => {
      if (raw instanceof Date) {
        return Number.isNaN(raw.getTime())
          ? ParseResult.fail(
              new ParseResult.Type(ast, raw, "invalid Date for a date column"),
            )
          : ParseResult.succeed(
              new Date(
                Date.UTC(raw.getFullYear(), raw.getMonth(), raw.getDate()),
              ),
            );
      }

      const match = YMD.exec(raw);
      if (match === null) {
        return ParseResult.fail(
          new ParseResult.Type(ast, raw, `${raw} is not a YYYY-MM-DD date`),
        );
      }

      const [, year, month, day] = match as unknown as [
        string,
        string,
        string,
        string,
      ];
      const date = new Date(Date.UTC(Number(year), Number(month) - 1, +day));

      // `Date.UTC` rolls 2026-02-30 forward into March rather than refusing it.
      return formatCalendarDate(date) === raw
        ? ParseResult.succeed(date)
        : ParseResult.fail(
            new ParseResult.Type(ast, raw, `${raw} is not a real date`),
          );
    },
    encode: (date) => ParseResult.succeed(formatCalendarDate(date)),
  },
).annotations({ identifier: "CalendarDate" });
