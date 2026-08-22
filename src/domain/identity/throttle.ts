import { Duration, Schema } from "effect";

/**
 * How many times a sign-in may be attempted, and from where.
 *
 * ## The attack, and the mitigation that is worse than it
 *
 * The attack a firm this size actually meets is credential stuffing: a list of
 * addresses and leaked passwords, tried in bulk. It is cheap, it is automated,
 * and the only thing that stops it is making attempts expensive.
 *
 * The obvious mitigation — lock the account after five failures — is a
 * **denial of service delivered by the safeguard**. Every advocate's address is
 * on the firm's website. Anyone who can read it can lock a partner out of their
 * own files on the morning of a hearing, five wrong passwords at a time, and
 * there is nothing the partner can do about it. Clearing the counter on a
 * successful sign-in does not help: the victim can never get far enough to
 * succeed.
 *
 * So **no counter is keyed on an account alone.** Every bucket below includes
 * the source address, which means an attacker can exhaust their own attempts
 * and nobody else's. A partner signing in from the office is unaffected by
 * whatever is being tried from a data centre in another country.
 *
 * ## Two buckets, doing different jobs
 *
 * - **Source and account together** stops one host working through a password
 *   list against one advocate. Five is above what a person mistyping reaches
 *   and far below what a script needs.
 * - **Source alone** stops the same host working through *many* accounts at one
 *   or two guesses each, which is what a stuffing list actually looks like and
 *   which the first bucket alone would never notice. Twenty, so that a firm
 *   behind one office NAT can have a bad Monday morning without being locked
 *   out collectively.
 *
 * ## What this does not stop, stated plainly
 *
 * A botnet with a fresh address per attempt defeats both buckets, because both
 * are keyed on the source. Nothing keyed on the source can do otherwise, and
 * the alternatives all reintroduce the lockout above. What raises the floor
 * there is a second factor, which this system does not have and which is named
 * here rather than left as an implication.
 */

/** Fifteen minutes, both to earn attempts back and to forget them. */
export const WINDOW = Duration.minutes(15);

/**
 * One counter, and what it permits.
 *
 * `bucket` is a name, not a stored key. The repository hashes it before it
 * writes it, so a table of rate-limit counters is not also a table of who tried
 * to sign in, from which address, and when. That matters more here than in most
 * systems: the people in it are advocates, and their clients' matters are
 * privileged.
 */
export interface Allowance {
  readonly bucket: string;
  readonly attempts: number;
}

/** Addresses are compared case-insensitively, so the counter has to be too. */
const normalised = (email: string): string => email.trim().toLowerCase();

/**
 * What a sign-in attempt spends from.
 *
 * The source is whatever the edge says the request came from; see
 * `sourceOf` in the sign-in action for why it is trusted only as far as it can
 * be. A missing source collapses to a single shared bucket rather than to no
 * limit at all — an unattributable request is not a free one.
 */
export const forSignIn = (
  source: string,
  email: string,
): readonly Allowance[] => [
  { bucket: `sign-in|${source}|${normalised(email)}`, attempts: 5 },
  { bucket: `sign-in|${source}`, attempts: 20 },
];

/**
 * What a one-click demo sign-in spends from (D-5).
 *
 * The switcher is a public button that mints a real session — no password is
 * typed, so every press succeeds. That breaks the assumption the two buckets
 * above are built on. `signIn` *forgets* its counters on success, which is
 * right when success means somebody proved who they are and wrong here, where
 * success is the thing being spent: a script pressing the button in a loop
 * would be forgiven every time and could open sessions and write audit rows
 * without limit.
 *
 * So this bucket exists and **is never forgotten**, and it is keyed on the
 * source alone because the account is not the visitor's choice in any
 * meaningful sense — there are six, and pressing all six is the intended use.
 *
 * Thirty in fifteen minutes is set for a person, not a fleet: a reviewer
 * clicking down the roster twice, plus room to be wrong about how many times
 * that is. What it bounds is a loop, which is the only thing here worth
 * bounding — the accounts are fixtures and the password is printed on the page,
 * so nothing behind the button is a secret. It buys back the property the
 * button gives away, and nothing more.
 */
export const forDemo = (source: string): readonly Allowance[] => [
  { bucket: `demo|${source}`, attempts: 30 },
];

/**
 * What a password-reset request spends from.
 *
 * Keyed on the source only, and tighter than a sign-in. A reset endpoint is an
 * amplifier: each request is a message sent to somebody who did not ask for it,
 * so the cost of an unthrottled one falls on the person being harassed rather
 * than on the attacker.
 */
export const forReset = (source: string): readonly Allowance[] => [
  { bucket: `reset|${source}`, attempts: 5 },
];

/**
 * Refused for trying too often.
 *
 * Deliberately distinct from `InvalidCredentials`, and deliberately *not*
 * telling the caller which bucket ran out or how many attempts remain. Both
 * would be a progress meter for the thing being throttled. What it does say is
 * how long to wait, because the person on the other end is usually somebody who
 * has forgotten their password and needs to know this ends.
 */
export class TooManyAttempts extends Schema.TaggedError<TooManyAttempts>()(
  "TooManyAttempts",
  { minutes: Schema.Number },
) {
  get reason(): string {
    return (
      `Too many attempts from this connection. ` +
      `Try again in ${this.minutes} minutes`
    );
  }
}

/** The refusal, with the window expressed the way the message needs it. */
export const refuse = (): TooManyAttempts =>
  new TooManyAttempts({ minutes: Math.ceil(Duration.toMinutes(WINDOW)) });
