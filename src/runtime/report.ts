import { Effect, LogLevel } from "effect";

/**
 * What a failure is worth saying, and how loudly.
 *
 * ## Why this file exists at all
 *
 * Until now every Server Action carried the same four lines:
 *
 * ```ts
 * if (error._tag === "RepositoryFailure") {
 *   console.error("[cases] repository failure", error);
 *   return "The matter could not be saved…";
 * }
 * ```
 *
 * Fourteen copies, one per module, each with its own prefix and its own idea of
 * what was worth printing — and a rule in the quality bar that says the
 * codebase contains no `console.log`. The copies were not the real problem.
 * The real problem is that they only fired for the failures somebody had
 * thought to single out: a `StorageFailure` from a document upload went to the
 * screen as a sentence and to the log as nothing at all.
 *
 * ## The rule
 *
 * A typed failure is reported once, at the boundary that swallows it, at a
 * level that follows from what kind of failure it is:
 *
 * - **Error** — `RepositoryFailure`, `StorageFailure`. Something is broken.
 *   Postgres will not answer, the blob store will not sign. Nobody did anything
 *   wrong and somebody needs to look.
 * - **Warning** — `NotPermitted`, `NotAuthenticated`. Nothing is broken, but a
 *   screen offered an operation the caller's role may not perform, which is a
 *   bug in the screen; or somebody is trying paths they were not given. Both
 *   are worth seeing and neither is an outage.
 * - **Debug** — everything else. "A claim beyond the court's limit", "that
 *   time entry is already on a fee note". The system worked. These are the
 *   *product*, and logging them at `Info` would bury the two categories above
 *   under the ordinary traffic of a firm being told no.
 *
 * The tag goes in the annotations rather than in the message, so a drain can
 * count refusals by kind — `AdvocateNotInPractice` rising for a week is a
 * practising certificate nobody renewed, which is a thing worth noticing and is
 * invisible in prose.
 */

const BROKEN: ReadonlySet<string> = new Set([
  "RepositoryFailure",
  "StorageFailure",
]);

const NOT_YOURS: ReadonlySet<string> = new Set([
  "NotPermitted",
  "NotAuthenticated",
]);

/**
 * Every failure in this codebase is a `Schema.TaggedError` with a `reason`
 * getter written for a person. Read defensively anyway: this sits on the
 * generic `E` of an arbitrary effect, and a boundary helper that threw while
 * reporting a failure would replace a legible error with an illegible one.
 */
const described = (
  failure: unknown,
): { readonly tag: string; readonly reason: string } => {
  if (typeof failure !== "object" || failure === null) {
    return { tag: "Unknown", reason: String(failure) };
  }

  const value = failure as {
    readonly _tag?: unknown;
    readonly reason?: unknown;
  };

  return {
    tag: typeof value._tag === "string" ? value._tag : "Unknown",
    reason: typeof value.reason === "string" ? value.reason : String(failure),
  };
};

/**
 * The level and the sentence are chosen together, and returned together, so
 * they cannot drift into a `WARN` line that reads like an outage.
 */
const howToSay = (
  tag: string,
): { readonly level: LogLevel.LogLevel; readonly message: string } => {
  if (BROKEN.has(tag)) {
    return { level: LogLevel.Error, message: "A dependency failed" };
  }

  if (NOT_YOURS.has(tag)) {
    return { level: LogLevel.Warning, message: "Refused: the caller may not" };
  }

  return { level: LogLevel.Debug, message: "Refused by a rule" };
};

/**
 * Logs the typed failure of an effect, and changes nothing else.
 *
 * `tapError` rather than `catchAll`: the failure carries on being the effect's
 * failure, so the caller still gets the `Either` it asked for and the type
 * signature is untouched. A defect is deliberately not touched either — that
 * one propagates to `onRequestError`, which sees the route it happened on.
 *
 * The trace id arrives on the line by itself, because the logger reads it from
 * the fiber. See `infra/telemetry/logging.ts`.
 */
export const reported = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.tapError(effect, (failure) => {
    const { tag, reason } = described(failure);
    const { level, message } = howToSay(tag);

    return Effect.logWithLevel(level, message).pipe(
      Effect.annotateLogs({ failure: tag, reason }),
    );
  });
