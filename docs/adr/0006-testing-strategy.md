# 6. Testing strategy: layered, hermetic, deterministic

**Status:** Accepted · **Date:** 2026-08-18 · **Decision ID:** D-7

## Context

The roadmap's quality bar forbids flaky tests. That rules out the two habits
that usually cause them: sleeping to wait for time-dependent behaviour, and
sharing a database between test runs.

## Decision

Three tiers, each with a different isolation strategy:

| Tier        | Runs against                     | Command                    |
| ----------- | -------------------------------- | -------------------------- |
| Domain      | Nothing. Pure functions.         | `npm test`                 |
| Service     | In-memory repository `Layer`s    | `npm test`                 |
| Integration | Real Postgres via Testcontainers | `npm run test:integration` |

**Virtual time.** Anything involving delay, retry, timeout, or deadline
computation is tested with Effect's `TestClock`. Tests advance the clock rather
than waiting on it — `test/harness.test.ts` verifies a one-hour sleep in 33ms.
`sleep` in a test is a defect.

**No mocking framework.** Dependencies are Effect services, so a test supplies a
different `Layer` instead of patching a module. This is the practical payoff of
ADR 0002 and the reason service tests need no database.

**Testcontainers over a shared or branched database.** Each integration run gets
a throwaway Postgres in Docker, identical locally and in CI. A shared dev
database makes runs interfere; Neon branch-per-run needs an API token in CI and
burns quota. Testcontainers is hermetic and requires no secrets.

Integration tests live in `*.integration.test.ts` under a separate Vitest config
so that a machine without Docker can still run `npm test` successfully.

## Consequences

- Docker Desktop is required locally to run integration tests. Unit and service
  tests, which are the bulk of the suite, need nothing.
- Container startup adds ~10–20s per integration run on a warm image cache.
- Coverage is measured over `src/domain`, `src/services`, and `src/lib` only.
  Including unwritten directories would report a number that measures nothing.
