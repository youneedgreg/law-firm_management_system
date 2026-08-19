/**
 * How a refusal reads in the browser.
 *
 * Every failure that reaches an atom is a tagged class, and the ones the
 * domain raises carry a `reason` written for an advocate — the rank and the
 * statutory limit, the statuses a matter may actually move to. Those are shown
 * as they are: the sentence was composed by the rule that refused, and
 * rephrasing it here would be a second copy of the Advocates Act, kept in a
 * component.
 *
 * What this module adds is the handful of failures that are *not* the domain's,
 * because they happen between the two ends: a request that never arrived, an
 * answer that could not be read. A `catch` around `fetch` would call all of
 * those "something went wrong". They are different problems with different
 * things to do about them, and the tag already tells them apart.
 *
 * The server has the same function in `app/(internal)/cases/actions.ts`, for
 * the same reason and with two of the same clauses. They are not shared: that
 * one explains a failure from a service called in-process, this one explains a
 * failure that crossed a network, and the overlap is two sentences rather than
 * a concept.
 */

/** Every failure in this system is a tagged class. That is the whole contract. */
interface Tagged {
  readonly _tag: string;
}

/**
 * A message for the person looking at the screen.
 *
 * `RepositoryFailure` is never among these — it carries the driver's message,
 * which can carry the query, so the server kills the fiber and answers with an
 * empty 500. What arrives here is a `ResponseError`, with nothing in it to
 * leak.
 */
export const explain = (error: Tagged): string => {
  switch (error._tag) {
    case "RequestError":
      return "The request did not reach the server. Check the connection and try again.";

    case "ResponseError":
      return "The server could not complete that. Nothing has been changed; the details are in the server log.";

    case "ParseError":
      return "The server's answer did not match what this page expects. It is probably running a newer version — reload to pick it up.";

    case "NotFound":
      return "That record is no longer on file. It may have been removed while this page was open.";

    default: {
      const reason: unknown = (error as { reason?: unknown }).reason;
      return typeof reason === "string"
        ? `${reason}.`
        : "That could not be completed.";
    }
  }
};
