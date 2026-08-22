import { Schema } from "effect";

/**
 * What the sign-in form submits.
 *
 * In its own module rather than in `actions.ts` because a `"use server"` file
 * may export nothing but async functions — and the form needs this value to
 * derive its input constraints, the way every other module does from its own
 * `forms.ts`.
 *
 * `NonEmptyTrimmedString` on a password is a real rule rather than a lazy
 * default: it refuses one with leading or trailing whitespace. That is already
 * how the server behaves, so deriving it only moves the refusal earlier — and
 * a trailing space is exactly the mistake nobody can see in a field of dots.
 */
export const Credentials = Schema.Struct({
  email: Schema.NonEmptyTrimmedString,
  password: Schema.NonEmptyTrimmedString,
});
