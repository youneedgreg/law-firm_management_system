import { Rx } from "@effect-rx/rx-react";
import { Data, Effect } from "effect";
import type { CaseStatus } from "../domain/case/status";
import type { AdvocateId, CaseId } from "../domain/shared/ids";
import { Api, browserRuntime } from "./browser";

/**
 * The cases module, as atoms.
 *
 * Every one of these goes through the client `HttpApiClient` derived from the
 * contract, so an endpoint renamed in `api/contract.ts` fails to compile here,
 * and a refusal arrives as the class the service failed with rather than as a
 * status code to interpret.
 *
 * ## What is here and what stayed on the server
 *
 * The matter *file* is still read by a Server Component: it is the page you
 * land on, it changes when the matter changes and not otherwise, and reading it
 * through `CaseService` in-process is one query rather than a query plus a
 * round trip from the browser to ask for the same thing.
 *
 * What is here is the two reads that answer to something the *browser* did. The
 * caseload is re-read whenever the filter changes, and the intake choices are
 * needed by a dialog that may never be opened — asking for them on every page
 * render, server-side, to fill a form nobody clicked, is work done on the
 * chance it is wanted. Both have a loading state and a failure state, because
 * both can be either, and an atom makes that a value rather than a variable
 * somebody remembered to set.
 */

/**
 * The caseload, filtered by status.
 *
 * Keyed by the filter, so each one is a separate atom with its own cached
 * answer: going back to a filter already seen is instant, and the registry's
 * idle TTL is what eventually discards it. The filter is applied by the service
 * in the query rather than by the table in the browser — the same filter the
 * API tests cover, and the difference between fetching the matters that were
 * asked for and fetching all of them to hide most.
 *
 * `refreshOnWindowFocus` covers the case this screen is most likely to be wrong
 * in: a matter opened, amended or closed in another tab. Coming back to this
 * one re-reads rather than showing the caseload as it was.
 *
 * `withServerValueInitial` is what keeps the fetch in the browser. React reads
 * it — not the atom — during the server render and again while hydrating, so
 * the server renders the loading state, nothing is fetched from a process with
 * no session and no origin, and the first client render matches the HTML.
 */
export interface CaseloadFilter {
  readonly status: CaseStatus | "all";
  /**
   * An advocate's own matters — the "My cases" view.
   *
   * Phase 5 filtered these in the browser against a hard-coded advocate name
   * from the seed data, with a comment saying Phase 6 would move it once there
   * was a signed-in user to filter by. This is that: the id comes from the
   * session, and the filter is applied by the service in the query.
   *
   * Still presentation, not authorization. An advocate may read the whole
   * caseload — `case:read` is not scoped by assignment, because a firm's staff
   * cover each other's matters — so this decides what to *show*, and the two
   * are not confused: the scope that is a security boundary belongs to portal
   * users and lives in `services/policy.ts`.
   */
  readonly advocateId?: AdvocateId | undefined;
}

const caseloadFamily = Rx.family((filter: CaseloadFilter) =>
  browserRuntime
    .rx(
      Effect.flatMap(Api, (api) =>
        api.cases.caseload({
          urlParams: {
            ...(filter.status === "all" ? {} : { status: filter.status }),
            ...(filter.advocateId === undefined
              ? {}
              : { advocateId: filter.advocateId }),
          },
        }),
      ),
    )
    .pipe(Rx.refreshOnWindowFocus, Rx.withServerValueInitial),
);

/** Keyed structurally, so the same filter is the same atom. */
export const caseloadRx = (filter: CaseloadFilter) =>
  caseloadFamily(Data.struct(filter));

/**
 * Who a matter may be opened for, and who may carry it.
 *
 * Read once and shared by every mount of the intake dialog. `keepAlive` because
 * the alternative is re-reading the firm's whole client list each time the
 * dialog is closed and opened again, and this is the one atom here whose answer
 * changes on a scale of days.
 */
export const intakeChoicesRx = browserRuntime
  .rx(Effect.flatMap(Api, (api) => api.cases.intakeChoices({})))
  .pipe(Rx.keepAlive, Rx.withServerValueInitial);

/**
 * A matter, and the status the server last said it had.
 *
 * The status is part of the key rather than a value written into the atom, and
 * that is the point: the key *is* the server's answer, so when the page is
 * re-read and the status has changed, the panel is handed a different atom
 * rather than one holding a stale value that something has to remember to
 * update. An atom keyed by id alone would keep the first status it ever saw.
 */
export interface Matter {
  readonly id: CaseId;
  readonly status: CaseStatus;
}

const key = (matter: Matter): Matter => Data.struct(matter);

const asServerSaidFamily = Rx.family((matter: Matter) =>
  Rx.make(matter.status),
);

/**
 * The status the panel shows, which is not always the status on file.
 *
 * `Rx.optimistic` wraps the server's answer in an atom that a mutation can move
 * ahead of the server and that reverts on its own if the server disagrees. The
 * guess is never written anywhere — no store, no cache, no second copy of the
 * matter — it exists for the length of the request and is then either confirmed
 * or dropped.
 */
const showingFamily = Rx.family((matter: Matter) =>
  Rx.optimistic(asServerSaidFamily(matter)),
);

export const showingStatusRx = (matter: Matter) => showingFamily(key(matter));

/**
 * Moving a matter through its lifecycle.
 *
 * Three things happen in order and the combinator is what keeps them in that
 * order: the shown status becomes the target immediately, the transition is
 * sent, and the result decides whether the guess stands. A refusal — the matter
 * moved in another tab, so this move is no longer legal — reverts the panel to
 * the status on file and arrives as `InvalidTransition`, whose `reason` names
 * the moves that *were* available. That sentence is composed on the server by
 * the domain's transition table and never transmitted; both ends hold the
 * class.
 *
 * Optimism is honest here for a specific reason: the buttons were built from
 * the server's own `mayBeMovedTo`, so acceptance is the overwhelmingly likely
 * outcome, and the round trip is a Neon query away — long enough for a button
 * that does nothing to feel broken.
 */
const moveFamily = Rx.family((matter: Matter) =>
  showingFamily(matter).pipe(
    Rx.optimisticFn({
      reducer: (_showing, to: CaseStatus) => to,
      fn: browserRuntime.fn((to: CaseStatus) =>
        Effect.flatMap(Api, (api) =>
          api.cases.transition({
            path: { id: matter.id },
            payload: { to },
          }),
        ),
      ),
    }),
  ),
);

export const moveRx = (matter: Matter) => moveFamily(key(matter));
