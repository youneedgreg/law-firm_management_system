# 2. Effect as the application runtime, end to end

**Status:** Accepted · **Date:** 2026-08-18

## Context

The system handles client money, statutory deadlines, and confidential matter
data. Three properties matter more than development speed:

1. **Failures must be visible in types.** A missed error path in a trust-account
   withdrawal is not a crash, it is a misappropriation.
2. **Dependencies must be swappable.** Business rules should be testable without
   a database, a clock, or a network.
3. **Time-dependent behaviour must be testable.** Statutory deadline computation
   and retry policies are worthless if the only way to test them is to wait.

Plain `async`/`await` with `try`/`catch` gives none of these. Thrown values are
untyped, dependencies arrive via import graphs, and time is ambient.

## Decision

Use Effect (`effect@3.22.x`) as the application runtime across the whole stack —
server _and_ client — rather than only in the backend.

- Domain modelling and validation: `effect/Schema`
- Dependency injection: Effect services and `Layer`
- Persistence: `@effect/sql-pg`
- HTTP contract: `@effect/platform` `HttpApi`
- Client state: `@effect-rx/rx-react`

### Why version 3.22 and not 4.0

Effect 4.0 exists as `4.0.0-rc.110` at the time of writing. It is not used
because `@effect-rx/rx-react` peer-depends on `effect@^3.17` and publishes no
v4 release track. Adopting Effect 4 today would mean giving up the client-side
Effect layer, which is the part that distinguishes this codebase from a
conventional Effect backend. Migration is planned as its own phase once the
ecosystem catches up.

### Schema import path

Schema is imported from `effect` core. The standalone `@effect/schema` package
is deprecated — npm's own metadata reads _"this package has been merged into the
main effect package"_. Most third-party documentation predates the merge, so any
source using `@effect/schema` should be treated as stale.

## Consequences

**Accepted costs:**

- Steep learning curve, and a smaller pool of engineers who can read it fluently.
- Smaller ecosystem than the Promise-based mainstream; some integrations must be
  wrapped by hand.
- The React layer is unconventional; `@effect-rx` is younger than TanStack Query.
- Effect's API moves quickly. Documentation found online is frequently stale, so
  the installed type definitions in `node_modules/effect/dist/dts/` are the
  reference of record, not blog posts.

**Gained:**

- Error paths enumerated in every signature; unhandled cases are compile errors.
- Business logic testable with in-memory layers — no mocking framework.
- `TestClock` makes timeout, retry, and deadline tests deterministic and instant.
  A one-hour sleep is verified in 33ms (see `test/harness.test.ts`).
- Tracing, structured logging, and retry policies are built in, not bolted on.
