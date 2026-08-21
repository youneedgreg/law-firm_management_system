import { Effect } from "effect";
import type { IntakeEnquiry } from "../domain/client/conflicts";
import { Api, browserRuntime } from "./browser";

/**
 * The conflict screen, as an atom.
 *
 * The one part of the clients module that belongs in the browser, and the
 * reason is the division Phase 5 drew: the client list and a client's file are
 * *documents* — read on the server, in-process, no HTTP hop. A conflict screen
 * is *interaction*. Somebody types a prospective client's name and the names of
 * the other side, reads what comes back, adds a party they had forgotten, and
 * reads it again. Doing that through a form submission would reload the route
 * on every attempt and lose what was typed.
 *
 * `Rx.fn` rather than a plain `rx`: this is not a read that happens because the
 * page rendered, it is one that happens because somebody asked. Nothing is
 * fetched until the button is pressed, and the result is a `Result` with its
 * own loading and failure states rather than three variables.
 */
export const screenRx = browserRuntime.fn((enquiry: IntakeEnquiry) =>
  Effect.flatMap(Api, (api) => api.clients.screen({ payload: enquiry })),
);

/**
 * Deliberately not cached or keyed by enquiry.
 *
 * A screen is a professional act performed at a moment, against the firm's
 * records as they stood then — and it is recorded in the audit trail as having
 * happened. Serving a cached answer would mean the trail says a screen was run
 * when it was not, which is the one thing that entry exists to say truthfully.
 */
