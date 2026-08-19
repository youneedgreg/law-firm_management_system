# 9. Effect Rx for client state, not TanStack Query and Zustand

**Status:** Accepted · **Date:** 2026-08-19

## Context

Phase 5 had to replace `components/AppState.tsx` — a React context around a
`useSyncExternalStore` around a module-level object, with `localStorage`
persistence hand-rolled inside it — and to give the browser a way to read server
data with loading and failure states that are not two booleans and a string.

The default answer is two libraries. **TanStack Query** for server state:
caching, refetching, invalidation, `isLoading`/`isError`/`data`, and mutations
with optimistic updates and rollback. **Zustand** (or Jotai, or Redux Toolkit)
for the session state that is genuinely the browser's. Both are excellent, both
are widely known, and between them they do everything this phase needed.

The alternative is `@effect-rx/rx-react`, which does both, and which the stack
was already committed to by ADR-0002: the whole server runs on Effect, the API
client is derived from an `HttpApi` definition, and the failures the domain
raises are tagged classes.

## Decision

Use `@effect-rx/rx-react`. One registry provided at the root, atoms for both
server reads and session state, and no other client-state library.

## Rationale

**The client already speaks Effect, and the alternatives do not.** An atom is
built from an `Effect`, and the effect it runs is a call on the generated
client. So a refusal arrives in the browser as `InvalidTransition` — the class
`CaseService` failed with, `reason` getter included — and the panel renders the
sentence the domain's transition table composed. TanStack Query would hand back
whatever the `queryFn` threw, and the tagged class would have to survive a
`fetch` wrapper somebody wrote, which is where the type stops being checked. The
value is not that Rx is better at caching; it is that nothing has to be
translated at the boundary.

**`Result` is one value, not three.** `isLoading`, `error` and `data` can
disagree; `Result.Initial | Success | Failure` cannot. `Result.builder` then
makes the render exhaustive, and — the part that decided it — rethrows anything
that is not a typed failure, so a refusal is rendered and a defect reaches the
error boundary. That is the same division the server draws between `attempt` and
`run`, appearing on the client for free rather than being re-implemented.

**One dependency instead of two, on a stack that already carries it.**
`@effect-rx/rx-react` was already in `package.json` before this phase — the
decision to stay on Effect 3.22 rather than the 4.0 release candidate turned on
it having no v4 track. Adding TanStack Query and Zustand would mean three
caching-and-state models in one app: Next's Router Cache, Query's cache, and the
session store.

**The optimistic mutation is a combinator, not a protocol.**
`Rx.optimistic` + `Rx.optimisticFn` are two lines in `rx/cases.ts` and the
component holds no state at all. TanStack's `onMutate`/`onError`/`onSettled`
does the same job, well, in about the same space — this one is a draw, and it
would be dishonest to claim otherwise.

## What this costs, honestly

- **The ecosystem is very small.** TanStack Query has hundreds of thousands of
  answered questions; Rx has a reference page and a handful of examples. Several
  things in this phase were settled by reading `node_modules` — that
  `Rx.withServerValue` is what keeps an atom from being evaluated during a
  server render, that `Rx.kvs` collapses its `Result` into a default, that
  `Rx.family` keys through Effect's `Equal` and so needs `Data.struct` rather
  than a plain object. None of that is written down anywhere else.
- **Nobody arrives knowing it.** A React developer joining this codebase knows
  Query and Zustand and does not know Rx. The concepts transfer — an atom is a
  store, a `Result` is the same three states — but the first week is slower.
- **It is pre-1.0, and moves.** `@effect-rx/rx` is at 0.48 and its peer range
  for `@effect/platform` was already behind this project's version, which is why
  `package.json` carries an `overrides` entry to dedupe it. Phase 11's Effect 4
  migration will have to wait for this package, which the stack decision already
  anticipated.
- **`Rx.kvs` was not usable as shipped**, so `rx/session.ts` reimplements the
  ~20 lines it does, with the `Result` left where a screen can read it. That is
  the shape of a small library: the piece you need is nearly there.

## Consequences

- `src/rx/` is the browser's composition root, with an ESLint boundary of its
  own: it may reach the shared half of `api/` and it may not reach `infra/` or
  `runtime/`, because either would put the Postgres driver in the client bundle.
- Session state is decoded through schemas on the way out of `localStorage`
  (`rx/records.ts`), which the module it replaced did not do. A stored role this
  build has never heard of is refused rather than rendered.
- Server Components keep the reads that are documents rather than interactions —
  the matter file is still read in-process through `CaseService`. Rx is not a
  reason to move a read to the browser; it is what to use once a read is
  genuinely the browser's.
- If this turns out to be wrong, the exit is not expensive: the atoms are behind
  `src/rx/`, and the screens read them through hooks. The thing that would be
  lost in a move to TanStack Query is the tagged failure, which is the reason
  for the decision in the first place.
