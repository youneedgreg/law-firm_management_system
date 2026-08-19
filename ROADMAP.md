# OKLaw — Engineering Roadmap

> A law-firm management system built as a portfolio-grade demonstration of
> production TypeScript: Effect end to end, Postgres, full test coverage, CI/CD,
> and documented architectural reasoning.

**Target:** portfolio-ready in 6–12 weeks · **Status:** Phase 4 complete

---

## How to use this document

This is the single source of truth for what gets built and in what order. Rules:

1. **Work top-down.** Phases are ordered by dependency, not by interest. Skipping
   ahead creates rework.
2. **Check boxes as you go.** `- [ ]` → `- [x]`. The diff is your progress log.
3. **Never leave `main` broken.** Every phase is built as vertical slices; the app
   must run and deploy at the end of every session.
4. **When reality diverges from this plan, edit this file** and note why in the
   Decision Log. A roadmap that lies is worse than none.
5. **Each phase has a "Demonstrates" line.** That is the sentence a reviewer should
   be able to say after reading that code. If the code does not earn the sentence,
   the phase is not done.

---

## 1. North star

When a senior engineer opens this repo, they should conclude, within ten minutes:

- **This person models domains properly.** Illegal states are unrepresentable.
  Errors are values, enumerated in type signatures, not thrown strings.
- **This person tests seriously.** Deterministic tests, no sleeps, no flakes,
  business rules covered — not just "renders without crashing".
- **This person can reason about architecture.** Layers are real and enforced.
  ADRs explain _why_, including the roads not taken.
- **This person ships.** There is a live URL. It is fast, accessible, and
  actually works.

The anti-goal: a tutorial CRUD app with a nice CSS theme. The wireframe is
already better than that; everything below is about earning the backend and the
rigor to match.

---

## 2. Where the project stands (2026-08-18)

**What exists:**

| Area          | State                                                                    |
| ------------- | ------------------------------------------------------------------------ |
| UI            | Next.js 16.3.1 App Router, React 19.2.8, ~26 routes                      |
| Routes        | 21 internal (`src/app/(internal)/`), 5 client portal (`src/app/portal/`) |
| Domain types  | `src/lib/types.ts` — 294 lines, hand-written interfaces + const unions   |
| Data          | `src/lib/data/*.ts` — hardcoded seed arrays, imported directly by pages  |
| State         | `src/components/AppState.tsx` — React Context + localStorage             |
| Styling       | `globals.css` + `broadsheet.css`, Phosphor icons                         |
| Design source | `design/OKLaw.dc.html` — original wireframe                              |

**What does not exist yet:** database, API, auth, authorization, validation,
tests, CI, error handling, logging, deployment, and any Effect at all.

---

## 3. Locked stack decisions

Versions verified on npm 2026-08-18. Pin exact versions; upgrade deliberately.

| Package                          | Version         | Notes                                                               |
| -------------------------------- | --------------- | ------------------------------------------------------------------- |
| `effect`                         | 3.22.1          | Core. **Schema lives here now** — `import { Schema } from "effect"` |
| `@effect/platform`               | 0.97.1          | `HttpApi`, `HttpApiClient`, platform abstractions                   |
| `@effect/platform-node`          | 0.108.1         | Node runtime layer (scripts, migrations, tests)                     |
| `@effect/sql` + `@effect/sql-pg` | 0.52.1 / 0.53.0 | SQL client, `Model`, migrations                                     |
| `@effect/vitest`                 | 0.30.0          | `it.effect`, `TestClock` integration                                |
| `@effect-rx/rx-react`            | 0.42.4          | Client-side Effect state                                            |
| `next` / `react`                 | 16.3.1 / 19.2.8 | Already installed                                                   |
| Database                         | Neon Postgres   | Provision via Vercel Marketplace (`vercel integration`)             |
| Hosting                          | Vercel          | Production deploy on every push to `main`                           |

### Three version facts that will bite you if you forget them

1. **`@effect/schema` is deprecated.** npm literally says _"this package has been
   merged into the main effect package"_. Most tutorials, blog posts, and LLM
   answers predate this. Use `effect/Schema`. If you see `@effect/schema` in an
   import, the source is stale — distrust the rest of it too.

2. **Effect 4.0 is in release candidate** (`4.0.0-rc.110` as of today) and is a
   substantial rewrite. **Do not start on it.** `@effect-rx/rx-react` peer-depends
   on `effect@^3.17` and publishes no v4 track — choosing Effect 4 today means
   giving up the client-side Effect layer you specifically asked for. Build on
   3.22.x. See Phase 11: the migration later is an _asset_, not a liability.

3. **Next.js 16 renamed Middleware to Proxy.** The file is `proxy.ts`, not
   `middleware.ts`. Confirmed in `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`.
   Also: use it for optimistic redirects only — real authorization belongs in the
   data layer, checked on every read.

> **Standing rule:** Effect's API surface moves fast and your training-data
> instincts about it are probably stale. Before writing Effect code, check the
> installed version's types in `node_modules/effect/dist/dts/`. Before writing
> Next code, check `node_modules/next/dist/docs/`.

---

## 4. Target architecture

```
src/
  domain/          Pure. Schemas, branded IDs, tagged errors, business rules.
    case/          No imports from services/ or infra/. No I/O. Fully testable
    client/        with zero setup. This is the layer that proves you can model.
    billing/
    shared/        Branded primitives: CaseId, Money, KRAPin, PhoneNumber…

  services/        Effect services (interface + Layer). Application use-cases.
    CaseService    Depends on repository *interfaces*, never concrete SQL.
    BillingService Orchestrates domain rules, transactions, authorization.
    AuthService

  infra/           The dirty edges. Implements interfaces defined above.
    sql/           @effect/sql-pg repositories, migrations, Model definitions
    blob/          File storage
    telemetry/     Tracing, logging, metrics

  api/             HttpApi definition (shared contract) + server implementation
  runtime/         ManagedRuntime — one per process, wires Layers together

  app/             Next.js routes. Thin. Server Components call the runtime.
  components/      React. Presentational + rx-connected containers.
  lib/             Formatting, nav config — genuinely shared leaf utilities.
```

**The one rule that makes this architecture real:** dependencies point inward.
`domain/` imports nothing from the project. `services/` imports `domain/`.
`infra/` imports both. `app/` imports `services/` and `runtime/`.

Enforce it mechanically in Phase 0 with an ESLint import boundary rule — an
architecture only documented in a README is an architecture that will erode by
month three.

---

## 5. Settled decisions

All resolved 2026-08-18. Each gets an ADR in Phase 0. Revisit only with a
recorded reason — churn on settled ground is how long projects die.

| ID  | Decision                                    | Consequence                                                                                                                                                                                             |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | **Single firm**, not multi-tenant           | No `firm_id`, no RLS. Documented in the README as a deliberate scope boundary. Knowing where to stop is the signal.                                                                                     |
| D-2 | **Better Auth**, self-hosted                | Users and sessions are real rows in your Postgres, modelled in Effect. You own session lifecycle and role assignment without hand-rolling password hashing.                                             |
| D-3 | **Deep Kenyan legal domain**                | Real court hierarchy, KRA PIN validation, Advocates Act trust rules, statutory deadlines from civil procedure rules, M-Pesa reconciliation. Requires actual research — budget for it in Phase 1.        |
| D-4 | **Vercel Blob**, private access             | Signed URLs, real versioning, identical in preview and production.                                                                                                                                      |
| D-5 | **Seeded accounts + role switcher**         | One-click login per role, rich demo data, nightly reset via cron. Doubles as a live showcase of the RBAC work.                                                                                          |
| D-6 | **Keep the hand-written CSS**, formalize it | Extract tokens, document the design system. The editorial look is an asset — most portfolios are default shadcn. No rewrite.                                                                            |
| D-7 | **Testcontainers** for integration tests    | Throwaway Postgres in Docker, identical locally and in CI. Hermetic, no external quota, no CI secrets. Docker required locally.                                                                         |
| D-8 | **Public repo from day one**                | Commit hygiene matters starting now. The visible wireframe → system progression is itself part of the portfolio.                                                                                        |
| D-9 | **Trunk-based: `main` only**                | No feature branches, no PRs, no branch protection. Solo project where PR review is self-review anyway. Cost is the lost CI gate before `main` — replaced by a pre-push hook and `verify:clean`. See §7. |

---

## 6. Phases

Time estimates assume a few hours per day. They are ranges, not commitments.

---

### Phase 0 — Foundations and guardrails · 2–3 days

Set up everything that makes later work fast and safe. Resist the urge to skip
to features; every hour here saves five later.

- [x] Push to GitHub, **repo public** (D-8) — `youneedgreg/law-firm_management_system`
- [x] Install Effect stack at pinned versions — resolved two peer conflicts without `--legacy-peer-deps`: `@vitejs/plugin-react@5.2.0` spans vite 7 and 8, and `@vitest/coverage-v8` had to stay on the v3 line to match `@effect/vitest`
- [x] `vitest` + `@effect/vitest` configured — `test/harness.test.ts`, 5 tests covering Effect execution, errors as values, `TestClock`, and `effect/Schema` decoding
- [x] ESLint import-boundary rules enforcing the layering in §4, plus a warning on every `@/lib/data/*` import as a Phase 7 burn-down list (59 today)
- [x] Prettier + lint-staged + husky pre-commit hook
- [x] Codebase formatted; `format:check` green and kept that way by the hook
- [x] `AppState` reads persisted state via `useSyncExternalStore` — clears the one `react-hooks/set-state-in-effect` error that kept lint red
- [x] GitHub Actions: format, typecheck, lint, test, build on every push to `main`; integration job stubbed behind `if: false` until Phase 12
- [x] ADRs 0001–0008 covering every decision in §5
- [x] Testcontainers installed and configured — verification against a real container deferred to Phase 12
- [x] Strict TS beyond `strict`: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noImplicitReturns`; `target` raised to `ES2022`. All 18 errors fixed and the staging config removed
- [x] Deployed to Vercel — <https://law-firmmanagementsystem.vercel.app> serving all routes
- [x] Trunk-based workflow adopted: `main` only, no feature branches, no PRs (D-9)
- [x] Pre-push hook running the full local suite — the only gate left once PRs are gone
- [x] Rewrite `README.md` — problem framing, screenshots, enforced architecture, stack, and an honest built-vs-planned section
      **Status:** Phase 0 complete. The full CI sequence passes from a wiped tree
      (`npm run verify:clean`), the app is deployed, and Docker verification moved to
      Phase 12 — it blocks nothing here.

**Done when:** a push to `main` runs green CI and deploys.
**Demonstrates:** I set up projects the way a team needs them, not the way a
solo hacker gets away with.

---

### Phase 1 — The domain in Effect Schema · 3–5 days

Rebuild `src/lib/types.ts` as a real domain model. Pure, dependency-free, and
exhaustively tested. This is the highest-leverage phase in the roadmap — it is
where "good engineer" is most visible per line of code.

**Research first (D-3).** Budget a week reading before coding: the Civil Procedure
Rules on filing and service timelines, the Advocates (Accounts) Rules on client
money, the court hierarchy and pecuniary jurisdiction limits, KRA PIN format.
Write it up as `docs/domain-notes.md` with citations — that document alone will
distinguish this from every other portfolio project.

- [x] **Research written up** as `docs/domain-notes.md`, every entry marked ✅ verified against primary text or ⚠️ secondary and unconfirmed. Pecuniary limits, Advocates (Accounts) Rules 2/4/9/10, and Limitation of Actions s. 4 are ✅; procedural timelines, KRA PIN spec, and High Court divisions remain ⚠️
- [x] `Money` as integer minor units (KES cents) — `add`/`subtract`/`multiply`/`allocate`, with `allocate` proven never to lose a cent across 1,400 splits
- [x] **Court hierarchy as a tagged union**, not a string: Supreme, Court of Appeal, High Court (+ division), Magistrates (+ rank and pecuniary limit), ELRC, ELC. `canHear` returns the statutory reason on refusal, and honours the s. 7(3) customary-law exemption
- [x] ESLint boundary gap closed: `domain/` could still import `@/lib/*`, and every rule was bypassable with a relative path. Both now blocked, verified with probe files
- [x] Branded ids and formatted identifiers: `CaseId`/`ClientId`/`InvoiceId`/`AdvocateId`/`DocumentId`/`HearingId`/`TrustMovementId` as branded UUIDs (not integers — portal urls should not be enumerable), plus `CaseNumber`, `KraPin`, `KenyanPhone`
- [x] `Case` and `Invoice` as `Schema.Struct` with real constraints — `Case` keeps the firm's reference and the court's cause number as separate fields, and `canFileIn` refuses a magistrates' court when no claim value is recorded rather than assuming it is within the limit. `Invoice` derives total and status instead of storing them, and represents `Overpaid` rather than hiding it
- [x] Remaining entities: `Client` (Individual|Corporate union — a corporate client must name someone who can instruct), `Advocate` (practising certificate gates `mayAppearInCourt`, checked per year), `Hearing` (an `Adjourned` outcome cannot exist without the date it went to), `Document` (versions append-only; filed documents cannot be revised), `TimeEntry` (non-billable time still recorded, and work cannot be invoiced twice)
- [x] Dates are `Date` throughout the new schemas, never strings; every date-dependent function takes `asAt` as a parameter rather than reading the clock
- [x] Case status as a **state machine**: `TRANSITIONS` declares the legal moves once, `transition` returns `Either`, and self-transitions are refused rather than treated as no-ops. Tests assert every status stays reachable from `New`, so the table and the union cannot drift apart
- [x] Tagged errors carrying their own explanation: `InvalidTransition`, `TrustAccountUnderfunded`, `OutsideCourtJurisdiction`, `CannotFileWithoutValue`, `PaymentExceedsBalance`, `NotAWithdrawal`, `FractionalCents`. Each exposes a `reason` citing the rule, so a refusal explains itself instead of surfacing as a bare failure. (`ConflictOfInterest` deliberately does not exist — see the screening item below)
- [x] **Trust-account invariants** per the Advocates (Accounts) Rules: Rule 10 enforced per-client rather than per-account, balance derived from movements rather than stored, withdrawal reasons limited to Rule 9's purposes, amounts always positive with direction from the reason. Mutation-tested — swapping the per-client check for the firm total fails exactly the two tests written for it
- [x] Limitation periods from the verified s. 4 figures — contract 6y, tort 3y, defamation 12mo — each result carrying its provision so the UI cites the reasoning. Month arithmetic clamps rather than overflowing (29 Feb + 3y lands on 28 Feb). Court holidays and vacation still outstanding, pending the §3.2 research
- [x] Conflict-of-interest screening on intake — returns findings with the matter and concern, never a boolean. An empty result carries `mattersSearched`, so "nothing matched in these records" cannot be read as "no conflict exists"
- [x] Exhaustive rather than sampled property tests where the space is small enough to enumerate: `allocate` over 1,400 amount/part combinations, the trust invariant over 40 interleaved withdrawals, every status pair through the transition table. Two mutation tests confirm the suite fails when the rule is broken
- [x] **Moved to Phase 2.** Decoding `src/lib/data/*.ts` through the schemas cannot happen here: the seed fixtures key on small integers and the domain keys on UUIDs, so the migration is the seed script's job, where real ids are minted. Attempting it now would mean writing a legacy-id adapter that Phase 2 immediately deletes

**Done when:** `src/domain/` has no imports from the rest of the project, and
tests cover every business rule.
**Demonstrates:** domain modelling, making illegal states unrepresentable,
errors as typed values.

---

### Phase 2 — Persistence · 3–4 days

- [x] Neon provisioned through the Vercel Marketplace (`neon-coffee-compass`), connected to the project, env vars pulled to `.env.local`. `DATABASE_URL` present in development
- [x] Migrations applied to real Neon via `npm run db:migrate`. Verified against the live database: 12 tables, the `trust_movements_rule_10` trigger present, zero non-bigint money columns, and an overdraw refused with `Advocates (Accounts) Rules r.10: cannot withdraw 30000000 cents against a balance of 20000000 cents`
- [x] `DATABASE_URL` present in preview and production. **This item was never actually outstanding** — the Neon Marketplace integration provisioned all three environments when it was installed, and the roadmap's "development only so far" was wrong. Verified with `vercel env ls` per environment, and all three resolve to the same Neon endpoint and database, so preview and production see the migrated, seeded data. That sharing is deliberate at portfolio scale (D-5's nightly reset); per-preview Neon branches are the obvious upgrade if preview ever writes
- [x] `sslmode=verify-full` pinned in the config layer rather than in the environment variable — Vercel owns `DATABASE_URL` and `vercel env pull` would overwrite a hand-edit, so one line in code covers development, preview and production permanently. `pg` v9's move to libpq semantics now arrives as a no-op instead of as a silent downgrade
- [x] `PgClient` layer in `src/infra/sql/client.ts`, with `DATABASE_URL` validated once at startup through a `Config` service and held `Redacted` so it cannot be logged by accident
- [x] Schema design: 12 tables, FKs, partial indexes, and constraints mirroring the domain — magistrate rank iff magistrates' court, adjournment iff a date to adjourn to, KRA PIN prefix matching client kind, no cause number without a filing date. **Rule 10 is enforced by a trigger** with `SELECT … FOR UPDATE`, since a `CHECK` sees one row and the rule needs the client's whole balance
- [x] Migration setup with `@effect/sql` migrator, listed explicitly via `fromRecord` rather than a glob, and run by `npm run db:migrate` as a standalone script — migrating from a serverless function means instances racing to alter the same schema
- [x] `@effect/sql` `Model` classes bridging DB rows ↔ domain schemas, expressed as `Schema.transformOrFail` rather than a pair of functions — **reads and writes share one mapping**, so encoding a `Case` produces exactly the record `sql.insert` takes and a column cannot be written in one shape and read in another. Built on the `insert` variant, so `created_at` stays the database's. Refusals the schema cannot express live here: a corporate client with no contacts, an invoice with no lines, a `MagistratesCourt` with no rank
- [x] Two column schemas for the conversions the driver gets subtly wrong: `bigint` arrives as a string and is refused rather than coerced when it will not round-trip; `date` arrives at _local_ midnight, so encoding always emits `YYYY-MM-DD`. A filing date that drifts one day is the difference between inside and outside a limitation period
- [x] Repository interfaces declared in `services/` (`CaseRepository`, `ClientRepository`, `TrustRepository`) — a service depends on the interface it needs and never on Postgres; the boundary rule makes that structural
- [x] `TrustRepositoryLive` in `infra/sql/`, which **translates the Rule 10 trigger refusal into the domain's `TrustAccountUnderfunded`**, reading the balance back only after Postgres has refused so the trigger stays the arbiter and the `FOR UPDATE` race stays closed
- [x] Integration tests against real Neon — 7 tests covering the driver, `@effect/sql`, and the error translation. Gated on `DATABASE_URL`, so a fresh checkout still runs `npm test` clean
- [x] `AdvocateRepository`, so the seed writes staff through the same boundary as everything else rather than dropping raw SQL into a script. The bridge refuses the half-populated practising certificate the `certificate_complete` constraint exists to prevent
- [x] `CaseRepository` and `ClientRepository` implementations. Clients are read as two queries and a group rather than a join — a join cannot distinguish "a client with no contacts" from "no such client", which is exactly the case the domain refuses
- [x] `InvoiceRepository`, needed by the settlement below: an aggregate across three tables with no stored total and no stored status, because the domain derives both
- [x] Transaction support, with the real multi-statement use case: `settleFromTrust` pays a fee note out of client money as one payment row plus one trust withdrawal. The withdrawal is written **last** on purpose — it is the write Rule 10 can refuse, so the rollback path is the one actually exercised. Mutation-tested: removing `withTransaction` fails three tests, including the one asserting a refused withdrawal leaves no payment row behind
- [x] Seed script (`npm run db:seed`) importing the existing mock data, **decoding every fixture through its domain schema** before anything is written. Failures accumulate and are reported together rather than short-circuiting — somebody fixing seed data wants the whole list, not its first line
- [x] Ids are **derived**, not generated: uuid v5 over a fixed namespace, keyed on the prototype's integers. That is what makes the import idempotent — a second run updates the same rows through the repositories' upserts instead of inserting a parallel copy of the firm, and it lets a matter reference its client before either has been written
- [x] The translation is where the work is, and it is pure and hermetically tested (46 tests). Free-text court names resolve through an explicit table where an unmapped name is a **failure, never a default**; the Tax Appeals Tribunal maps to _no court_, because it is constituted under its own Act and is not in the Article 162 hierarchy. The prototype's stored invoice status is reconstructed from lines and payments and the adapter refuses if the domain then derives something else
- [x] `Ledger.overdrawnClients` runs against the adapted movements before any write, and `TrustRepository.overdrawn` runs against Postgres after. A seeded ledger that breaches Rule 10 stops the import
- [x] **Schema verified against real Postgres without Docker**: PGlite runs Postgres 18 in WebAssembly in-process, so `schema.test.ts` applies the actual DDL — trigger included — and then attacks every constraint. 27 tests, ~2s, in the default suite. Caught one real defect: the trust-balance view returned `numeric` rather than `bigint`
- [x] **Migration 0002** — two defects that only surfaced once rows had to round-trip through the domain. `cases.filed_on` was `NOT NULL DEFAULT '1970-01-01'`, an epoch sentinel for "not filed" that the mapping had to hide on every access; it is nullable now. `client_contacts` had no ordering column, so `contacts[0]` — the person the firm takes instructions from — was whichever row Postgres returned first
- [x] **Migration 0003** — the same omission in the two other places a domain list is stored as rows: `invoice_lines` and `payments`. An invoice is a document a client reads, and `received_on` is a `date`, so it cannot break the tie between two payments on the same day, which is exactly what a double-posted M-Pesa confirmation looks like
- [x] `.env.local` is loaded by `db:migrate` and by the integration config, so the database-backed tests can no longer pass by silently skipping themselves
- [ ] Testcontainers integration tests over the real driver and `@effect/sql` (D-7) — still Phase 12, and now a much narrower gap: 34 integration tests already run against real Neon

- [x] **Both gaps the seed surfaced, closed.** `KenyanPhone` accepted mobile ranges only, so a corporate client's switchboard landline could not be represented and the seed was substituting a mobile — falsifying data to satisfy a type that was too narrow. The type was the thing that was wrong: it now takes any nine-digit Kenyan number, `phoneKind` keeps the mobile/fixed distinction knowable (Phase 7 texts hearing reminders, and a landline cannot receive one), and **migration 0004** widens the matching `CHECK`. The substituted numbers are gone and the fixtures' real landlines are stored
- [x] `openedOn` and `filedOn` were seeded equal, which said every matter was filed the day it walked in the door. Intake dates are supplied per matter in `MATTER_SUPPLEMENT` and are **required** — a matter with no entry fails the import rather than falling back to the filing date again

**Done when:** the seed data lives in Postgres and repository tests pass against
a real database in CI.
**Demonstrates:** you treat the database as part of the design, not a dumb store.

---

### Phase 3 — Services and the first vertical slice · 3–4 days

Take **Cases** all the way through the new stack while every other module still
runs on mock data. Prove the architecture on one slice before committing to it
across twenty.

- [x] `CaseService` as an `Effect.Service` with a Layer, depending only on the repository _interfaces_ declared in `services/`. What it adds over them is the work that spans them: resolving the client and advocate names a screen shows, deriving the next matter reference from every reference already issued, and the rules that need a stored fact — whether a court may hear the claim, and whether the assigned advocate holds a practising certificate
- [x] **Three consistency rules moved into `domain/case`**, where they can be checked on a `Case` that never reaches a database: a filing date before the intake date, a cause number with no filing, half a limitation clock. Each mirrors a constraint in the schema on purpose — the database stays the backstop and stops being the normal path. A filed matter with _no_ court remains legal, because the Tax Appeals Tribunal is outside the Article 162 hierarchy
- [x] **The Advocates Act rule that needed a service to enforce it**: only an advocate holding a current practising certificate may file (s. 9, s. 31), so `open` and `amend` refuse a filing by anyone else — but _only when the write is the act of filing_. Editing a matter filed in 2025 does not re-file it, and demanding a current certificate for that would make historic files uneditable over a year the system has no record of. Both directions mutation-tested
- [x] **The derived matter reference is a real race, and is not papered over.** `OKL-2026-041` is computed from what is stored, so two intakes at once compute the same one; `cases.number` is `UNIQUE`, the repository translates the unique violation into `CaseNumberTaken` exactly as the Rule 10 trigger becomes `TrustAccountUnderfunded`, and `open` retries onto the next free number. The in-memory fake enforces the same uniqueness, so removing the retry fails the test
- [x] Service-level tests with in-memory repository Layers — 38 tests, no database, no container, no cleanup, nothing to skip when Docker is down. The Postgres implementations are still tested against real Postgres; the _rules_ run in 250ms. **A fake that accepts writes the real one refuses is a fake that makes tests pass and production fail**, so the fakes enforce what the schema enforces
- [x] `ManagedRuntime` in `src/runtime/` — the only file that knows both that `CaseService` exists and that it is backed by Postgres. Held on `globalThis` behind a symbol, because Next re-evaluates modules on every dev edit and a module-level `const` opens a fresh pool per save until Neon refuses connections
- [x] Wire `/cases` and `/cases/[id]` to real data via Server Components. `generateStaticParams` is gone: matters are rows, and a build-time id list would 404 every file opened after the deploy
- [x] Create and edit cases through Server Actions with `Schema` validation at the boundary. `FormData` is decoded through a schema rather than parsed by hand — a hand parser makes `NaN` from a mistyped amount and `Invalid Date` from a mistyped date, and both reach the service looking like data. `errors: "all"` plus `ArrayFormatter` puts each message against the input that caused it
- [x] Courts are picked whole from the firm's list rather than assembled from four inputs, so a form cannot produce the `MagistratesCourt` with no rank that the tagged union exists to forbid
- [x] Error handling: `run` lets a failure reject into `error.tsx`; `attempt` returns the typed failure as a value via `Effect.either`, so a refusal is a message beside the form and a defect still reaches the boundary. `RepositoryFailure` is the one refusal not shown — it carries a driver message that can carry the query, so it goes to the log
- [x] Optimistic UI on status transitions, with the buttons built from `Status.TRANSITIONS` by way of the service, so there is no second list to fall out of step with the state machine
- [x] `serverExternalPackages: ["pg", …]`. Bundling the driver for Server Components hangs the first query and returns `PgClient: Connection timed out`, while the identical layer under `tsx` connects in under a second
- [x] Cases removed from the browser-side `CreatedRecords` store. A second answer to what the firm has on its books is one the caseload screen would not show and no invoice could be raised against
- [x] Verified end to end against Neon in the browser: the caseload reads, a matter opens and lands on its file as `OKL-2026-041`, a Resident Magistrate refuses a 9m claim with the statutory reason, a filing date before the intake date is refused, a status moves optimistically and settles, an unknown id 404s and a malformed one 404s the same way

> **A refused form must not lose what was typed.** React resets an uncontrolled
> `<form action={…}>` once the action returns, which is right after a success and
> destructive after a refusal. The submitted values come back in the action's
> result and go out through `defaultValue` — and the fields are remounted by
> key, because React applies `defaultValue` to a `<select>` only at mount, so
> without it the text fields keep their values while every dropdown snaps back
> to its placeholder. Half a restored form is worse than none.

> **What is deliberately still mock.** Hearings, documents and invoices on the
> matter file, and every other module's case picker, still read `lib/data`.
> That is the shape of a vertical slice: one module through the whole stack, the
> rest untouched until its own migration. The seam is visible in the UI and says
> so.

**Done when:** cases are fully real — read, create, edit, transition — and the
test suite covers the service with mock Layers.
**Demonstrates:** dependency injection that pays off, testability without mocking
frameworks.

---

### Phase 4 — Typed HTTP API · 2–3 days

- [x] `HttpApi` definition in `src/api/contract.ts` — the shared contract, and the only description of this API. The router, the client and the OpenAPI document are all derived from it; none is written by hand
- [x] **The domain does not fit on a wire, and `wire.ts` is why.** Every date in `domain/` is `Schema.DateFromSelf`, which encodes to a `Date` — not a JSON value. The wire schemas are built by spreading each domain schema's own `fields` and restating only the dates, so a field added to `Case` appears on the API in the same commit, with the same constraints, because it is the same schema object
- [x] **Two compile-time proofs, because one was not enough.** `WIRE_MATCHES_DOMAIN` asserts each schema decodes to exactly the domain type. Testing it by deliberately leaving a date on `DateFromSelf` showed it passing anyway — both decode to `Date`, so the equality holds while a `Date` still goes on the wire. `WIRE_IS_JSON` asserts the _encoded_ side is JSON, and is the one that catches it. Both verified by breaking them
- [x] `RESPONSES_MATCH_SERVICES` does the same for the composed shapes, which are hand-written and where drift is likeliest: a field added to `CaseFile` that nobody adds here fails typecheck rather than going quietly missing from every generated client
- [x] Endpoint groups: **cases** (read, open, amend, transition), **clients** and **billing** (read). `ClientService` and `BillingService` added — thin, and existing because both of their operations span two repositories; a handler doing that join would be application logic living in the transport
- [x] **No `documents` group, deliberately.** Documents have a domain model and two tables and nothing in between — no repository, no row↔domain mapping, nothing seeded, no upload path until Phase 7 wires Blob. Endpoints for it would serve an empty array from an empty table. The entire argument for generating a client from a contract is that the contract is true; shipping one that is not, to fill in a checkbox, spends the only thing the design has going for it. Moved to Phase 7, which already owns Documents
- [x] Status codes annotated on the error schemas once, in `failures.ts`, rather than per endpoint — 404 for absence, 409 where the stored state conflicts, 422 where a rule refuses the submitted values. `RepositoryFailure` is the one refusal never named: it carries the driver's message, which can carry the query, so it is logged and dies, and `@effect/platform` answers a defect with an empty 500 that has no body to leak into
- [x] Server mounted at `src/app/api/[[...path]]/route.ts` — one optional catch-all, because routing is the contract's job and a directory of route files mirroring the endpoints would be a second description of the paths
- [x] **One connection pool, not two.** `toWebHandler` builds the Layer it is given, and `AppLayer` contains `PgLive` — so left alone the API would open a second pool beside the one Server Components already use. It is passed the `ManagedRuntime`'s own `memoMap`, so `PgLive` is built once and shared. The alternative works locally, works in preview, and starts refusing connections at exactly the traffic where you would rather it did not
- [x] `HttpApiClient` derived from the same definition. No `fetch` call, no URL built by hand, no response type written down — and a refusal arrives as the _class_ the service failed with, so `catchTag("AdvocateMayNotFile", (e) => e.reason)` compiles on the client and prints a sentence that was never transmitted. Both ends hold the schema; only the encoded form crosses
- [x] OpenAPI generated by `OpenApi.fromApi` from the same value — served at `/api/openapi.json`, rendered at `/api/docs`. 8 paths, 41 schemas, and the annotated status codes present on every operation
- [x] **API-level tests through the generated client, 30 of them, with no socket.** `toWebHandler` produces the same object Next mounts, so the tests drive the real router, real handlers and real services, and reach them through the real client — only the repositories are arrays. Encoding, routing and contract are all in the path. **If server and client could drift, this is where it shows.** Verified by breaking it twice: renaming an endpoint fails the client and the tests, adding a response field the service does not return fails the handler
- [x] The clock is stopped at a fixed instant via `Layer.setClock`. `mayAppearInCourt` compares a certificate year against today and `Billing.status` derives "Overdue" from now, so on a real clock these tests would pass today and go false one at a time in January. `TestClock` cannot reach inside a Layer built by `toWebHandler`; this can
- [x] ESLint boundary for `src/api/**`, plus a narrower rule naming the five files that make up the _shared_ half of it — those may not import `runtime/`, because Phase 5's browser client imports them. A probe walked straight through the first version: `../runtime` matches neither `@/runtime` nor `**/runtime/**`, so **every boundary declared since Phase 0 had the same hole** for directory imports. `layer()` now covers `**/dir` too
- [x] Verified against Neon in the browser and over curl: the caseload and client directory read real seeded rows, an invoice derives Partially Paid with its outstanding balance, a Resident Magistrate refuses a 9m claim as 422 with the rank and the limit, an unknown id is 404 and a malformed one is 400, and a matter was opened, amended and transitioned through HTTP before being removed again

> **What is deliberately still mock.** The screens for clients, billing and every
> other module still read `lib/data`. Phase 4 moved the seam rather than closing
> it: those modules now have real read endpoints over real Postgres data, and
> the UI has not been pointed at them yet. That is Phase 5's and Phase 7's work,
> and the seam is still visible in the UI and still says so.

**Done when:** the client is generated from the contract and a type error appears
if server and client drift.
**Demonstrates:** end-to-end type safety across the network boundary.

---

### Phase 5 — Effect on the client · 3–4 weeks

The part you specifically asked for. Retire `AppState.tsx`.

- [ ] `@effect-rx/rx-react` installed and a runtime provided to the tree
- [ ] Rx atoms for server data with loading and error states as first-class values
- [ ] Rewrite role switching and invoice state as Rx
- [ ] Mutation atoms with optimistic updates and rollback on failure
- [ ] Persist selected state to localStorage via an Rx-integrated `KeyValueStore`
- [ ] Component tests covering loading, success, and failure paths
- [ ] ADR: why Rx over TanStack Query / Zustand, honestly weighed

**Done when:** no `useState`-based data fetching remains; every async client
state has explicit loading and error handling.
**Demonstrates:** Effect fluency beyond the server, and a considered take on
client state.

---

### Phase 6 — Identity, authorization, audit · 4–5 weeks

The legal domain makes this genuinely interesting: seven roles, and a client
portal that must _never_ leak another client's data.

- [ ] Better Auth with sessions in Postgres (D-2)
- [ ] Login, logout, password reset, session refresh
- [ ] `CurrentUser` as an Effect service, provided per request
- [ ] RBAC as a typed policy layer — permissions checked in services, not in components
- [ ] **Row-level authorization:** portal users see only their own cases. Test this adversarially: write tests that _attempt_ the leak and assert failure
- [ ] `proxy.ts` for optimistic route protection (not the real gate)
- [ ] Audit log: every mutation records actor, action, entity, timestamp, before/after
- [ ] Wire the existing `/compliance` and audit UI to real audit data

**Done when:** a portal user cannot reach another client's data by any route,
proven by tests, and every mutation is audited.
**Demonstrates:** security thinking, and that you test the negative cases —
which is what separates senior from mid-level.

---

### Phase 7 — Breadth: the remaining modules · 8–12 weeks

Now grind out the rest, module by module, each a full vertical slice with tests.
Order chosen by domain value: money and deadlines first.

- [ ] **Billing** — invoices, line items, payments, M-Pesa reconciliation, trust accounts enforcing the Phase 1 invariants at the DB level too
- [ ] **Time tracking** — timers, billable/non-billable, feeding invoice generation
- [ ] **Clients** — CRUD, contacts, conflict-of-interest checking on intake
- [ ] **Hearings & calendar** — scheduling, adjournments, statutory deadline computation, reminders
- [ ] **Documents** — real uploads to private Vercel Blob (D-4), signed URLs, versioning, categories, access control. **Carries Phase 4's deferred `documents` endpoint group**: the repository and the row↔domain mapping have to exist before there is anything for a contract to describe, and they land here
- [ ] **Tasks** — assignment, priorities, due dates
- [ ] **Client portal** — case visibility, invoices, secure messaging
- [ ] **Communications, notifications, knowledge base, HR, users** — lighter slices
- [ ] **Reports** — aggregate queries, financial summaries, exports
- [ ] **Global search** across cases, clients, and documents

**Done when:** no `src/lib/data/*.ts` mock imports remain in `src/app/`.
**Demonstrates:** sustained delivery and consistency at scale — twenty modules
built to the same standard is itself the signal.

---

### Phase 8 — Observability and resilience · 2–3 weeks

- [ ] OpenTelemetry tracing via `@effect/opentelemetry`, exported to a free-tier backend
- [ ] Structured logging with request correlation IDs
- [ ] Retry policies with exponential backoff on transient DB failures
- [ ] Timeouts on every external call
- [ ] Rate limiting on auth endpoints
- [ ] Health check endpoint and error tracking (Sentry)
- [ ] `TestClock`-based tests for retry and timeout behaviour — deterministic, no sleeps

**Done when:** you can trace a slow request end to end, and resilience policies
are proven by tests that run in milliseconds.
**Demonstrates:** production thinking, and the deterministic-testing superpower
that is Effect's best sales pitch.

---

### Phase 9 — Product polish · 3–4 weeks

- [ ] **Formalize the design system** (D-6): extract CSS custom properties into a documented token layer, write `docs/design-system.md`, keep the editorial identity
- [ ] Accessibility audit: keyboard navigation, focus management, ARIA, contrast. Target WCAG 2.2 AA
- [ ] Headless primitives only where hand-rolling a11y is genuinely hard — dialog, combobox, date picker. Everything else stays hand-written CSS
- [ ] Responsive pass — the wireframe is desktop-first; fix mobile
- [ ] Loading skeletons and empty states everywhere
- [ ] Form validation UX driven by the same schemas as the server
- [ ] Lighthouse ≥ 95 across the board; Core Web Vitals green
- [ ] Playwright E2E covering the critical paths: login, create case, log time, invoice, pay
- [ ] Dark mode, if the design supports it cleanly

**Done when:** the app is genuinely pleasant to use on a phone and a screen reader.
**Demonstrates:** you finish things, and you consider users who are not you.

---

### Phase 10 — Portfolio packaging · 2–3 weeks

The phase most people skip, and the one with the highest return per hour.

- [ ] **README rewrite**: problem, screenshots/GIF, architecture diagram, stack rationale, how to run, what you learned
- [ ] Demo login page with one-click role switcher, rich seeded data, nightly reset via cron (D-5)
- [ ] ADR set complete and readable as a narrative
- [ ] Architecture diagram: system context, layers, request lifecycle
- [ ] Database ER diagram, generated
- [ ] Test coverage badge, CI badge, live demo link at the top
- [ ] A written case study — 1,500 words on the hardest problem you solved. Trust-account invariants or row-level authorization are strong candidates
- [ ] Commit history readable: meaningful messages, no `wip` noise
- [ ] Ask two engineers for honest review; fix what they trip on

**Done when:** a recruiter reaches a working demo in one click, and an engineer
understands the architecture without running anything.
**Demonstrates:** communication — the skill most portfolios fail on.

---

### Phase 11 — Effect 4 migration _(optional, high value)_ · 3–4 weeks

Only once Effect 4 is stable **and** `@effect-rx` ships a v4-compatible release.

- [ ] Read the migration guide; inventory breaking changes
- [ ] Migrate on a branch with CI green at each step
- [ ] ADR documenting the migration and what broke
- [ ] Blog post or README section on the experience

**Demonstrates:** you can carry a real codebase through a major version bump —
a genuinely rare and valuable thing to be able to point at.

---

### Phase 12 — Docker and Testcontainers verification · 2–3 days

Deferred deliberately: installing Docker Desktop is not on the critical path,
and nothing before this point is blocked by leaving it until the end.

- [ ] Install Docker Desktop
- [ ] Run `npm run test:integration` against a real Postgres container
- [ ] Flip the `if: false` guard on the `integration` job in `.github/workflows/ci.yml`
- [ ] Confirm the job passes on GitHub's runners, where Docker is already available
- [ ] Record the container startup cost, and set `fileParallelism` accordingly

**Done when:** integration tests run green locally and in CI.
**Demonstrates:** hermetic testing against real infrastructure — no shared
database, no fixtures that drift from the schema.

> **Dependency worth knowing about.** Phase 2 writes integration tests against
> Postgres, and Phase 6 tests row-level authorization adversarially. Both are
> far more convincing when they run against a real database. Until this phase
> lands, those tests can be written but not executed locally — CI is where they
> first run for real, which is a slower feedback loop than it sounds. If Phase 2
> starts to feel like guesswork, pull this phase forward; it is two days.

---

## 7. Quality bar

Applies to every commit from Phase 0 onward. Non-negotiable.

- No `any`. No `as` casts outside parsing boundaries. No `@ts-ignore`.
- Every fallible operation returns a typed error. No thrown strings.
- Every business rule has a test. Every bug fix starts with a failing test.
- No `console.log` in committed code — structured logging only.
- No secrets in the repo. All config through validated env schemas.
- Tests are deterministic. No `sleep`, no wall-clock dependence, no flakes.
- Every commit: one coherent change, a message explaining why, green locally.

### What trunk-based development costs (D-9)

Working directly on `main` removes the review gate, and on a public repo a
broken `main` is visible. Two CI failures have already slipped through on state
that existed locally but not in a clean checkout. The substitutes:

- **The pre-push hook** runs lockfile, format, typecheck, lint, and tests. It is
  the last gate before a mistake is public. Bypass with `--no-verify` only when
  you have a reason you could say out loud.
- **`npm run verify:clean`** before anything structural — dependency changes,
  config changes, anything touching the build. It wipes `node_modules` and
  `.next` and runs CI's exact sequence. Both failures so far would have been
  caught by it.
- **Commit discipline replaces review.** Nobody else is reading the diff, so the
  commit message is the only record of intent. Write it for the person who has
  to understand this in six months.
- **Fix forward, never rewrite.** `main` is public and deployed; no force-pushes,
  no rewriting shared history. A revert commit is honest and cheap.

---

## 8. Decision log

Append as decisions are made. This becomes the raw material for your ADRs and
the most interesting thing an interviewer can read.

| Date       | Decision                            | Reasoning                                                                                                                                                                        |
| ---------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-18 | Effect 3.22.x, not 4.0-rc           | `@effect-rx/rx-react` peer-deps on `effect@^3.17` with no v4 track; choosing v4 today would cost the client-side Effect layer                                                    |
| 2026-08-18 | Effect end to end, including React  | Deliberate: the client-side story is the differentiator vs. typical Effect backends                                                                                              |
| 2026-08-18 | Neon Postgres + Vercel              | Free at portfolio scale, clean `@effect/sql-pg` fit, one-click live demo                                                                                                         |
| 2026-08-18 | D-1 Single firm                     | Multi-tenancy is plumbing, not signal; a stated scope boundary reads as judgment                                                                                                 |
| 2026-08-18 | D-2 Better Auth, self-hosted        | Own the interesting parts (sessions, roles, audit) without hand-rolling crypto                                                                                                   |
| 2026-08-18 | D-3 Deep Kenyan domain              | Researched jurisdictional detail is the cheapest way to look senior                                                                                                              |
| 2026-08-18 | D-4 Vercel Blob, private            | Private-by-default matters for legal documents; no infra overhead                                                                                                                |
| 2026-08-18 | D-5 Seeded accounts + role switcher | Zero friction to a full dashboard; doubles as an RBAC showcase                                                                                                                   |
| 2026-08-18 | D-6 Keep hand-written CSS           | Distinctive beats default shadcn; rewriting working CSS buys nothing                                                                                                             |
| 2026-08-18 | D-7 Testcontainers                  | Hermetic and identical locally and in CI; no quota, no CI secrets                                                                                                                |
| 2026-08-19 | Docker verification → Phase 12      | Installing Docker blocks nothing early; deferring keeps Phase 0 shippable. Pull forward if Phase 2 needs the feedback loop                                                       |
| 2026-08-19 | D-9 Trunk-based, `main` only        | PR review is self-review on a solo project; pre-push hook and `verify:clean` replace the lost CI gate                                                                            |
| 2026-08-18 | D-8 Public repo from day one        | Forces commit hygiene now; the wireframe → system progression is the story                                                                                                       |
| 2026-08-19 | Row↔domain mapping as a schema      | A `transformOrFail` has an encode side, so reads and writes cannot drift apart the way two hand-written functions do                                                             |
| 2026-08-19 | Ordering columns for domain lists   | `contacts[0]` and an invoice's line order carry meaning; a `SELECT` with no `ORDER BY` has no first element                                                                      |
| 2026-08-19 | `sslmode` pinned in code, not env   | Vercel owns `DATABASE_URL` and `vercel env pull` overwrites hand-edits; one line covers every environment                                                                        |
| 2026-08-19 | In-memory repositories, not mocks   | A second implementation of an interface that already existed. No framework, no stubbed method names to keep in sync — and the fakes enforce what the schema enforces             |
| 2026-08-19 | Certificate checked on filing only  | The domain holds the _current_ certificate and no history, so re-checking on every edit would block historic files over a year the system cannot speak to                        |
| 2026-08-19 | Reference race left to the index    | A database sequence would remove the race and hand out gaps on every rollback; a client-visible reference is the wrong place for gaps. `UNIQUE` + retry instead                  |
| 2026-08-19 | Courts chosen whole, not assembled  | Four free inputs can build a `MagistratesCourt` with no rank; a keyed list cannot, and a firm files in a known set of stations anyway                                            |
| 2026-08-19 | Wire schemas separate from domain   | `DateFromSelf` encodes to a `Date`, which JSON cannot carry. Derived from the domain's own `fields`, so only the dates are restated, and guarded twice so neither half can drift |
| 2026-08-19 | No `documents` endpoint group       | No repository, no mapping, nothing seeded. A generated client is only worth having if the contract is true; an endpoint over an empty table to tick a box spends exactly that    |
| 2026-08-19 | Errors are the domain's own classes | Re-declaring them in `api/` would hand the client a different class with the same name. Sharing them means `reason` is reconstituted on the client rather than transmitted       |
| 2026-08-19 | API shares the runtime's `memoMap`  | Otherwise `toWebHandler` builds `PgLive` a second time: two pools in one process, each sized for the whole process, against a database with a connection limit                   |
| 2026-08-19 | `RepositoryFailure` dies, not fails | It carries the driver's message, which can carry the query. A defect gets an empty 500 — there is no body, so there is no encoder to be talked into including the detail         |

---

## 9. Progress log

One line per session. Keeps momentum visible across a long project.

| Date       | Phase | What moved                                                                                                                                                                          |
| ---------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-18 | —     | Wireframe committed; roadmap written; all eight architectural decisions settled                                                                                                     |
| 2026-08-19 | 2     | Row↔domain mapping, case/client/invoice repositories, the trust settlement transaction, migrations 0002–0003. 263 unit tests, 34 integration                                        |
| 2026-08-19 | 2     | Seed script: the wireframe's fixtures decoded into Postgres through the domain schemas, idempotent on derived ids. 309 unit tests, 39 integration                                   |
| 2026-08-19 | 2     | Closed the two gaps the seed surfaced: `KenyanPhone` widened to fixed lines (migration 0004), intake dates supplied per matter. 336 unit tests                                      |
| 2026-08-19 | 3     | `CaseService`, the runtime, and the Cases slice end to end: Server Components read Neon, Server Actions decode through Schema, refusals render as sentences. 385 unit tests         |
| 2026-08-19 | 4     | Typed HTTP API: one contract, from which the router, the client and the OpenAPI document are all derived. Cases, clients and billing; documents deferred to Phase 7. 415 unit tests |
