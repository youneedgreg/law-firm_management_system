# OKLaw

**A practice management system for a Kenyan law firm** — matters, court diary,
trust accounting, billing, documents, and a client portal.

Built as a study in production TypeScript: [Effect](https://effect.website) end
to end, a domain modelled from actual Kenyan statute rather than a generic CRUD
schema, and an architecture whose layering is enforced by the linter rather than
by good intentions.

**[▸ Live demo](https://law-firmmanagementsystem.vercel.app/dashboard)** — no
login yet; the role switcher in the top bar changes what the app shows.

[![CI](https://github.com/youneedgreg/law-firm_management_system/actions/workflows/ci.yml/badge.svg)](https://github.com/youneedgreg/law-firm_management_system/actions/workflows/ci.yml)

> **Status: in development.** The interface is complete and interactive across
> 27 routes. The Effect backend is being built module by module: matters are
> real — Postgres, a typed domain model, a generated HTTP API, and Rx atoms in
> the browser — and every other module still runs on seed data. Auth and
> authorization are next, phase by phase, in [`ROADMAP.md`](ROADMAP.md). This
> README describes what is true today and marks what is not. See
> [Honest status](#honest-status).

---

![Managing Partner dashboard](docs/images/dashboard.jpg)

---

## The problem

Small and mid-sized firms in Nairobi run on a patchwork of spreadsheets,
WhatsApp, and paper diaries. The consequences are specific and expensive:

- **A missed court date** is not an inconvenience; it can mean a matter
  dismissed for want of prosecution.
- **Client money held in trust** is governed by the Advocates (Accounts) Rules.
  Commingling it with firm money is a disciplinary matter, not a bookkeeping
  error.
- **Conflicts of interest** must be checked before a matter is opened, against
  every client the firm has ever acted for or against.

These are rules with hard edges, which makes them a good fit for a type system.
Most of the interesting work in this repository is about encoding them so that
violating one fails to compile, or fails loudly at a boundary, rather than
producing a quietly wrong number.

## Screens

| Case detail                                 | Billing and trust                   |
| ------------------------------------------- | ----------------------------------- |
| ![Case detail](docs/images/case-detail.jpg) | ![Billing](docs/images/billing.jpg) |

The client portal is a separate surface with its own layout and a strict
visibility rule — a portal user may only ever see their own matters:

![Client portal](docs/images/client-portal.jpg)

## Architecture

Dependencies point inward. The domain knows nothing about how it is stored or
served, which is what makes it testable without any infrastructure at all.

Directories marked ○ are the target layout and do not exist yet — they are built
in Phases 1–4 of the roadmap.

```
src/
○ domain/      Pure. Schemas, branded IDs, tagged errors, business rules.
               No I/O, no framework, no imports from anywhere else in src/.
○ services/    Effect services and Layers. Depends on repository interfaces
               it declares itself, never on a concrete implementation.
○ infra/       The dirty edges: Postgres repositories, blob storage, telemetry.
○ api/         HttpApi definition — one contract, server and client derived.
○ runtime/     ManagedRuntime wiring the Layers together.
● app/         Next.js App Router. Thin; calls into services.
● components/  React components.
● lib/         Formatting, nav config, and (for now) seed data.
```

This is enforced, not documented. `eslint.config.mjs` declares the boundaries as
`no-restricted-imports` rules, so a service reaching into `infra/` fails CI:

```js
{
  name: "domain",
  files: ["src/domain/**/*.ts"],
  forbidden: ["@/services/*", "@/infra/*", "@/api/*", "@/app/*", ...],
  because: "domain/ must stay pure: no I/O, no framework, no knowledge of
            how it is stored or served.",
}
```

An architecture that lives only in a README erodes by month three.

## Why Effect

Three properties matter more here than development speed, and plain
`async`/`await` provides none of them:

**Errors are values, in the type signature.** A missed error path in a trust
account withdrawal is not a crash — it is a misappropriation. Every fallible
operation enumerates what it can fail with, and an unhandled case is a compile
error rather than a runtime surprise.

**Dependencies are injected as Layers.** Business rules are tested by supplying
a different implementation, not by patching modules. There is no mocking
framework in this repository and there will not be one.

**Time is virtual in tests.** Statutory deadline computation, retry policies,
and timeouts are worthless if the only way to test them is to wait. Effect's
`TestClock` makes them instant and deterministic — the harness test verifies a
one-hour sleep in 33 milliseconds:

```ts
it.effect("collapses a one-hour sleep to nothing under TestClock", () =>
  Effect.gen(function* () {
    const fiber = yield* Effect.fork(
      Effect.sleep(Duration.hours(1)).pipe(Effect.as("woke up")),
    );

    yield* TestClock.adjust(Duration.hours(1));

    expect(yield* Fiber.join(fiber)).toBe("woke up");
  }),
);
```

The full reasoning, including the costs, is in
[ADR 0002](docs/adr/0002-effect-as-the-application-runtime.md).

## Stack

● in use · ○ chosen, not yet wired up

| Layer               | Choice                           | Why                                                                                        |
| ------------------- | -------------------------------- | ------------------------------------------------------------------------------------------ |
| ● Framework         | Next.js 16, React 19             | App Router, Server Components                                                              |
| ● Runtime           | Effect 3.22                      | Typed errors, Layers, virtual time                                                         |
| ● Testing           | Vitest + `@effect/vitest`        | Hermetic, deterministic, no shared state                                                   |
| ● Styling           | Hand-written CSS                 | A deliberate choice — see [ADR 0007](docs/adr/0007-keep-the-hand-written-design-system.md) |
| ○ Validation        | `effect/Schema`                  | One schema for parsing, types, and DB mapping                                              |
| ○ Database          | Neon Postgres + `@effect/sql-pg` | Relational domain; invariants as constraints                                               |
| ○ Auth              | Better Auth, self-hosted         | Sessions as rows we own and can join against                                               |
| ○ Files             | Vercel Blob, private             | Legal documents are confidential by default                                                |
| ○ Integration tests | Testcontainers                   | Throwaway Postgres per run; no shared state                                                |

Two version notes that trip people up: `Schema` is imported from `effect` core —
the standalone `@effect/schema` package is deprecated and merged in. And
Next.js 16 renamed Middleware to Proxy (`proxy.ts`).

## Domain modelling — the target

**Not yet implemented.** This section states the design that Phase 1 builds, so
the intent is reviewable before the code exists.

The seed data is Kenyan and the model commits to it. A court is not a string:

```ts
export const Court = Schema.Union(
  SupremeCourt,
  CourtOfAppeal,
  HighCourt, // + division
  MagistratesCourt, // + tier, pecuniary jurisdiction limit
  EmploymentAndLabourRelationsCourt,
  EnvironmentAndLandCourt,
);
```

Money is integer minor units, never floating point. Client funds obey the
Advocates (Accounts) Rules as an invariant rather than a convention:

```ts
const withdraw = (account: TrustAccount, amount: Money) =>
  Money.greaterThan(amount, account.balance)
    ? Either.left(new TrustAccountUnderfunded({ account, amount }))
    : Either.right(debit(account, amount));
```

Research notes with citations will live in `docs/domain-notes.md`, written before
the schemas so the statutory basis for each invariant is on the record.

## Running it

Requires Node 24+ and npm. Docker is needed only for integration tests.

```bash
npm install
npm run dev          # http://localhost:3000
```

| Command                    | What it does                                           |
| -------------------------- | ------------------------------------------------------ |
| `npm run dev`              | Development server                                     |
| `npm test`                 | Unit and service tests — no database required          |
| `npm run test:integration` | Integration tests against real Postgres (needs Docker) |
| `npm run typecheck`        | `next typegen && tsc --noEmit`                         |
| `npm run lint`             | ESLint, including architecture boundaries              |
| `npm run verify`           | Everything CI runs                                     |
| `npm run verify:clean`     | The same, from a wiped `node_modules` and `.next`      |

Typechecking runs `next typegen` first because `PageProps` and `LayoutProps` are
globals Next generates into `.next/types/`. Without it, `tsc` passes on a machine
that has built recently and fails on a fresh checkout.

That failure mode — green locally, red in CI, because of state a clean checkout
does not have — is what `verify:clean` exists to catch before pushing.

This repository is trunk-based: all work lands on `main`, with no feature
branches or pull requests. Two hooks stand in for the review gate — pre-commit
runs Prettier and ESLint on staged files, and pre-push runs the lockfile check,
formatting, typecheck, lint, and tests. CI then runs the full suite, including
the build, on every push to `main`, which also deploys.

## Honest status

The distinction between built and planned matters, so here it is plainly.

**Working today:** all 27 routes, ~16,000 lines of TypeScript beside ~6,500
lines of tests and ~1,550 lines of CSS, deployed to Vercel. **Matters are real end to end**: a Kenyan legal
domain modelled from statute, Neon Postgres behind repositories, `CaseService`,
an `HttpApi` contract from which the router, the client and the OpenAPI document
are all derived, and — in the browser — `@effect-rx/rx-react` atoms that read the
caseload through that generated client and move a matter through its lifecycle
optimistically. 433 unit tests and 39 integration tests, architecture boundaries
enforced by the linter, CI on every push, and nine ADRs.

Every other module still runs on the wireframe's seed arrays, with its create
flow persisting to the browser through an Effect `KeyValueStore`: clients,
hearings, tasks, time entries, appointments, documents, invoices and
communications. Role switching across seven roles, filtering, search, and a
client portal.

**Not built yet:** authentication and authorization, and the eight modules
listed above. Their data lives in `src/lib/data/*.ts` as seed arrays, so those
screens are per-browser on the live demo: what you create there is yours alone
and disappears when you clear site data. Every import of those files raises an
ESLint warning — 54 today — which doubles as the migration checklist.

**Deliberately out of scope:** multi-tenancy. One firm, seven roles. Adding
`firm_id` to every table and every query would be plumbing rather than signal;
the reasoning is in [ADR 0003](docs/adr/0003-single-firm-scope.md).

## Documentation

- [`ROADMAP.md`](ROADMAP.md) — the plan, phase by phase, with progress
- [`docs/adr/`](docs/adr/) — nine architecture decision records, including the
  arguments against each choice

---

Built by [Gregory Temwa Odete](https://github.com/youneedgreg).
