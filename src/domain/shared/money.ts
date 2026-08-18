import { Either, Schema } from "effect";

/**
 * Kenyan shillings, held as an integer number of cents.
 *
 * Never a float. `0.1 + 0.2 !== 0.3` is a rounding curiosity in most software
 * and a reconciliation failure in a trust ledger, where the balance is a legal
 * obligation rather than a display value. Every amount in the system is a whole
 * number of cents, and division is the only operation allowed to lose precision
 * — it does so explicitly, through `allocate`.
 */

export const Money = Schema.Int.pipe(
  Schema.brand("Money"),
  Schema.annotations({
    identifier: "Money",
    description: "An amount in Kenyan cents (KES ×100), as a whole number",
  }),
);

export type Money = typeof Money.Type;

/** Raised when an amount cannot be represented exactly in cents. */
export class FractionalCents extends Schema.TaggedError<FractionalCents>()(
  "FractionalCents",
  { shillings: Schema.Number },
) {}

const unsafe = (cents: number): Money => cents as Money;

export const zero: Money = unsafe(0);

/** Builds an amount from whole cents. */
export const fromCents = (cents: number): Money => {
  if (!Number.isSafeInteger(cents)) {
    throw new TypeError(`Money must be a whole number of cents, got ${cents}`);
  }
  return unsafe(cents);
};

/**
 * Builds an amount from shillings, rejecting anything finer than a cent.
 *
 * Returns an `Either` rather than rounding: silently absorbing a third of a
 * cent is how ledgers drift, and the caller is better placed to decide whether
 * an odd fraction is a typo or a rate that needs `allocate`.
 */
export const fromShillings = (
  shillings: number,
): Either.Either<Money, FractionalCents> => {
  const cents = shillings * 100;
  return Number.isSafeInteger(Math.round(cents)) &&
    Math.abs(cents - Math.round(cents)) < Number.EPSILON
    ? Either.right(unsafe(Math.round(cents)))
    : Either.left(new FractionalCents({ shillings }));
};

export const add = (a: Money, b: Money): Money => unsafe(a + b);

export const subtract = (a: Money, b: Money): Money => unsafe(a - b);

export const negate = (amount: Money): Money => unsafe(-amount);

export const isZero = (amount: Money): boolean => amount === 0;

export const isNegative = (amount: Money): boolean => amount < 0;

export const isPositive = (amount: Money): boolean => amount > 0;

export const greaterThan = (a: Money, b: Money): boolean => a > b;

export const lessThan = (a: Money, b: Money): boolean => a < b;

export const sum = (amounts: readonly Money[]): Money =>
  amounts.reduce<Money>(add, zero);

/**
 * Multiplies by a quantity — hours worked, copies produced — rounding half up
 * to the nearest cent. The only rounding in the module, and it is deliberate:
 * an hourly rate times 2.5 hours has to land on a cent eventually.
 */
export const multiply = (amount: Money, factor: number): Money =>
  unsafe(Math.round(amount * factor));

/**
 * Splits an amount into `parts` without losing a cent.
 *
 * Naive division leaves a remainder — KES 10.00 in three ways is 3.33 thrice
 * and a cent unaccounted for. The remainder is distributed one cent at a time
 * across the leading parts, so the parts always sum back to the original.
 */
export const allocate = (amount: Money, parts: number): readonly Money[] => {
  if (!Number.isInteger(parts) || parts < 1) {
    throw new TypeError(`Cannot allocate across ${parts} parts`);
  }

  const base = Math.trunc(amount / parts);
  const remainder = amount - base * parts;
  const step = remainder < 0 ? -1 : 1;

  return Array.from({ length: parts }, (_, index) =>
    unsafe(base + (index < Math.abs(remainder) ? step : 0)),
  );
};

/** Formats for display, e.g. `KES 1,150,000.00`. */
export const format = (amount: Money): string =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 2,
  }).format(amount / 100);
