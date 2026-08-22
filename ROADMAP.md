# OKLaw — Engineering Roadmap

> A law-firm management system built as a portfolio-grade demonstration of
> production TypeScript: Effect end to end, Postgres, full test coverage, CI/CD,
> and documented architectural reasoning.

**Target:** portfolio-ready in 6–12 weeks · **Status:** Phase 8 complete

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

| Package                          | Version         | Notes                                                                                    |
| -------------------------------- | --------------- | ---------------------------------------------------------------------------------------- |
| `effect`                         | 3.22.1          | Core. **Schema lives here now** — `import { Schema } from "effect"`                      |
| `@effect/platform`               | 0.97.1          | `HttpApi`, `HttpApiClient`, platform abstractions                                        |
| `@effect/platform-node`          | 0.108.1         | Node runtime layer (scripts, migrations, tests)                                          |
| `@effect/sql` + `@effect/sql-pg` | 0.52.1 / 0.53.0 | SQL client, `Model`, migrations                                                          |
| `@effect/vitest`                 | 0.30.0          | `it.effect`, `TestClock` integration                                                     |
| `@effect-rx/rx-react`            | 0.42.4          | Client-side Effect state                                                                 |
| `next` / `react`                 | 16.3.1 / 19.2.8 | Already installed                                                                        |
| `@effect/opentelemetry`          | 0.64.0          | Effect's tracer, built from the **globally registered** provider                         |
| `@vercel/otel`                   | 2.1.3           | Registers that provider in `instrumentation.ts`; picks its exporter from the environment |
| Database                         | Neon Postgres   | Provision via Vercel Marketplace (`vercel integration`)                                  |
| Hosting                          | Vercel          | Production deploy on every push to `main`                                                |

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
  rx/              The same idea in the browser: the Layer the atoms are built
                   from, the atoms, and the React bindings for reading them.

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

| ID   | Decision                                    | Consequence                                                                                                                                                                                                                                                                |
| ---- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1  | **Single firm**, not multi-tenant           | No `firm_id`, no RLS. Documented in the README as a deliberate scope boundary. Knowing where to stop is the signal.                                                                                                                                                        |
| D-2  | **Better Auth**, self-hosted                | Users and sessions are real rows in your Postgres, modelled in Effect. You own session lifecycle and role assignment without hand-rolling password hashing.                                                                                                                |
| D-3  | **Deep Kenyan legal domain**                | Real court hierarchy, KRA PIN validation, Advocates Act trust rules, statutory deadlines from civil procedure rules, M-Pesa reconciliation. Requires actual research — budget for it in Phase 1.                                                                           |
| D-4  | **Vercel Blob**, private access             | Signed URLs, real versioning, identical in preview and production.                                                                                                                                                                                                         |
| D-5  | **Seeded accounts + role switcher**         | One-click login per role, rich demo data, nightly reset via cron. Doubles as a live showcase of the RBAC work.                                                                                                                                                             |
| D-6  | **Keep the hand-written CSS**, formalize it | Extract tokens, document the design system. The editorial look is an asset — most portfolios are default shadcn. No rewrite.                                                                                                                                               |
| D-7  | **Testcontainers** for integration tests    | Throwaway Postgres in Docker, identical locally and in CI. Hermetic, no external quota, no CI secrets. Docker required locally.                                                                                                                                            |
| D-8  | **Public repo from day one**                | Commit hygiene matters starting now. The visible wireframe → system progression is itself part of the portfolio.                                                                                                                                                           |
| D-9  | **Trunk-based: `main` only**                | No feature branches, no PRs, no branch protection. Solo project where PR review is self-review anyway. Cost is the lost CI gate before `main` — replaced by a pre-push hook and `verify:clean`. See §7.                                                                    |
| D-10 | **Error tracking without a second SDK**     | Exceptions reach the traces backend on the span they failed, and `onRequestError` writes the digest, message, stack and route to the log drain. Sentry would add a build-time wrapper, a client bundle and a DSN to send a third copy of the same event. Added 2026-08-21. |

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

### Phase 5 — Effect on the client · 3–4 days

The part you specifically asked for. Retire `AppState.tsx`.

- [x] `src/rx/` — the browser's composition root, and the mirror image of `runtime/`. `Rx.runtime` over a Layer holding the generated API client (`FetchHttpClient`) and a `KeyValueStore`; `RegistryProvider` at the root of the tree with a 30-second idle TTL, so moving between two filters or into a matter and back does not refetch. Its own ESLint boundary: it may reach the shared half of `api/`, and not `infra/`, `runtime/`, `app/` or `components/`
- [x] Rx atoms for server data, with `Result` as the value rather than three variables. The caseload as a family keyed by the status filter, and the intake choices, both through `HttpApiClient` — so an endpoint renamed in the contract fails to compile here, and a refusal arrives as the class the service failed with. `Result.builder` renders the three cases exhaustively **and rethrows anything that is not a typed failure**, so a defect reaches `error.tsx`: the client half of the `attempt`/`run` division the server already draws
- [x] **`Rx.withServerValue` is what makes this safe under SSR, and it is not optional.** Next renders every client component on the server first. React reads the _server value_ — not the atom — during that render and again while hydrating, so a fetching atom shows its loading state and never issues a request from a process with no origin, and a persisted atom shows its default so the first client render matches the HTML byte for byte. Without it a `localStorage` read runs during a server render and a hydration mismatch throws the tree away. There is a test asserting exactly that: a stored role reads back in the browser and still renders the default on the server
- [x] Role switching, firm settings, the prototype's created records and the invoice-status overrides are four independent atoms, not one context object. A component that reads the role no longer re-renders when an invoice is marked paid. `AppState.tsx` is deleted; 24 components and 38 call sites moved
- [x] **The session store is decoded through schemas now** (`rx/records.ts`), which the module it replaced admitted it did not do — it kept whatever survived `Array.isArray`. `RECORDS_MATCH_TYPES` proves each schema decodes to exactly the interface the screens are written against, so a field added to one and not the other fails to compile. A stored role this build has never heard of is refused at the boundary and the atom falls back to the default
- [x] Mutation atom with optimistic update and rollback: `Rx.optimistic` over the status the server last gave, `Rx.optimisticFn` over the transition endpoint. The panel holds **no state at all** — not `useState`, not `useOptimistic`. The shown status, the pending flag and the refusal are all read out of two atoms. Verified in the browser by moving a matter behind the page's back with `curl` and then clicking a move that was legal when the page rendered: the guess appears, the server refuses, the panel snaps back and prints "A matter that is Closed cannot become Under Review; it may only become Appealed" — a sentence composed on the server by the domain's transition table and never transmitted
- [x] The `moveCase` Server Action is gone with it. Opening and amending stay actions, because both are forms and a `<form action>` submits without JavaScript; a status button is not a form and had no reason to be a second way into the same service
- [x] `KeyValueStore` over `localStorage`, chosen at layer construction rather than at module load, so a server render gets the in-memory store instead of a `ReferenceError`. `@effect/platform-browser` ships this layer and reaches `localStorage` eagerly, which is right for an app that only runs in a browser and wrong for one that is server-rendered first
- [x] **`Rx.kvs` was not usable as shipped**, and the reason is worth stating: it collapses the read into `Result.getOrElse(defaultValue)`, so "nothing is stored" and "the store has not answered yet" are the same value. A screen that confuses those renders "no such client" for one that is about to appear. `rx/session.ts` is the same ~20 lines with the `Result` left where it can be read, and `hydratedRx` is the conjunction of all four reads
- [x] **18 new tests: 9 through React over the real API with no socket, and 9 against the session atoms directly.** The same `toWebHandler` the API tests use, behind a stubbed global `fetch`: React reads an atom, the atom calls the generated client, the real router decodes, the real service answers, and the component renders it — only the repositories are arrays. Loading is asserted against an API held open on purpose, because a test that awaited the response could not tell an optimistic update from a fast one
- [x] ADR [0009](docs/adr/0009-effect-rx-for-client-state.md): Rx over TanStack Query and Zustand, with the four things it costs written down — a very small ecosystem, nobody arriving knowing it, a pre-1.0 dependency that needed an `overrides` entry to dedupe `@effect/platform`, and a library helper that had to be rewritten
- [x] Verified against Neon in the browser: the caseload reads from the API and filters without a navigation, the intake dialog fills its two selects from the firm's real clients and staff with "(may not file)" where the Advocates Act says so, a matter was moved through the lifecycle and back, a stale move was refused and rolled back, and a chosen role survived a full reload

> **The trade the caseload made, stated plainly.** A Server Component read
> reaches Postgres in-process — one query, no hop. The caseload now asks the
> browser to make an HTTP request to a route that makes the same query. What it
> buys: the filter is answered without a navigation, each filter's answer is
> cached in the browser, a matter closed in another tab appears when this one
> regains focus, and loading and failure are states the table renders rather
> than a `loading.tsx` and an `error.tsx` for the whole segment. The matter
> _file_ did not move and should not: it is the page you land on and link to,
> and it changes when the matter changes rather than in response to anything the
> browser does. Filtering is interaction; a file is a document.

**Done when:** no `useState`-based data fetching remains; every async client
state has explicit loading and error handling.
**Demonstrates:** Effect fluency beyond the server, and a considered take on
client state.

---

### Phase 6 — Identity, authorization, audit · 4–5 days

The legal domain makes this genuinely interesting: seven roles, and a client
portal that must _never_ leak another client's data.

- [x] Better Auth 1.7.1 with sessions as rows in Postgres (D-2), behind a `SessionGateway` interface declared in `services/`. Its four tables are written by **migration 0005**, not by the library's CLI — `users` is not only its table, it is where a login is tied to a member of staff or a client. The shape is verified rather than assumed: `auth-schema.test.ts` asks `getSchema` which columns the configured instance needs and compares them against the DDL in a real Postgres, so a field added by a future version (`account.issuer` arrived in 1.7) fails a test instead of the first sign-in
- [x] **One pool, not two.** Better Auth needs its own connection and a connection _string_ would have doubled the pool — the same failure Phase 4 avoided with a shared `memoMap`, arriving the same way. `PgPool` is now a service; `PgClient.layerFromPool` and `betterAuth({ database: pool })` are handed the same object. The `pool.on("error")` handler came with it: `pg` emits on an idle client dropping, which Neon does routinely, and an unhandled `error` event takes the process down
- [x] Sign-in, sign-out and password reset. Sign-in and sign-out are **Server Actions**, so the form works without JavaScript and a refusal is the same typed `ActionState` every other form uses; the `/api/auth` catch-all _refuses_ those two paths, because both are audited in `IdentityService` and a second route to the same session machinery would be a way in that leaves no trace. Session refresh is Better Auth's, capped at one write a day. Reset has no mail transport yet (Phase 7 owns communications) so the link is logged — a real gap, stated in the code as one
- [x] `CurrentUser` as a `Context.Tag`, provided per request — and this is the load-bearing decision. It is in the `R` channel of every operation that checks a permission, so **an effect cannot be run without a principal**: forgetting the check is a compile error at the call site rather than a review comment. Provided by `runAs`/`attemptAs` for pages and actions, and by an `HttpApiMiddleware` for every endpoint at once
- [x] RBAC as data: `subject:verb` permissions in a closed union, one table from role to grants, in `domain/identity/permissions.ts`. Read for the absences — a Receptionist sees no figure of the firm's money, a Finance Officer cannot move a matter through its lifecycle, and the System Administrator is deliberately **not** a superuser. Nobody holds `trust:write`, because there is no operation behind it yet
- [x] **`Principal` is a tagged union.** `Staff` carries a role and an advocate id; `PortalUser` carries a client id and no role at all. There is no value that is both, so no check can be written against the wrong half — and `users_exactly_one_subject` says the same thing in Postgres, attacked in `schema.test.ts` from both directions
- [x] **Row-level authorization, and the scope is in the query.** A portal user's caseload is `forClient`, so the rows they may not see are never read — there is no array for a later `.filter` to be forgotten from. Permission says which verbs; scope says over which rows; both are required and they are checked separately
- [x] **An out-of-scope record is reported as absent.** `withinScope` fails with `NotFound`, not `NotPermitted`: a truthful "you may not see this matter" confirms the matter exists, and with it the client, and that this firm acts for them. Staff are treated the other way — a Receptionist refused the fee notes gets a 403 with the reason, because everyone at the firm knows they exist. Scope conceals; permission explains
- [x] **Tested adversarially, at two layers.** Wanjiku's portal login asks for Zenith's matter — as a _valid signed-in user_, which is the shape of the real attack — and gets the same answer, byte for byte, as for an id that belongs to nothing. Once against the service with arrays, once over HTTP through the generated client, plus the mirror case with Zenith's login so the scope demonstrably comes from the principal
- [x] `proxy.ts` for optimistic redirects, documented in the file as **not a security boundary** — it checks that a cookie is _present_, verifies nothing, and excludes `/api` so an unauthenticated fetch gets a 401 in JSON rather than a page of HTML with a 200 on it
- [x] Audit log: actor, action, entity, timestamp, before and after, **inside the mutation's transaction**. A trail written afterwards produces exactly the gap it exists to close, so `Transactor` is an interface in `services/` and the in-memory one rolls back the same stores — the test that breaks the audit write and asserts the matter does not survive it is mutation-verified. The actor is _copied_, not joined: staff leave and roles are reassigned, and an entry is a statement about the past
- [x] `audit_log` is append-only in Postgres. A trigger refuses `UPDATE` and `DELETE` outright, so the refusal holds for a cleanup script and a psql session as well as for this application
- [x] `/compliance` reads the real trail, showing the fields that moved rather than two blobs of JSON. It is the one refusal a screen renders rather than throws — arriving without `audit:read` means a typed URL, which deserves a sentence
- [x] **The role switcher is gone.** `roleRx` let the browser choose a role, which was right for a wireframe and wrong the moment there was a session; the principal is resolved on the server and reaches the screens through `components/Session.tsx`. `lib/nav.ts` now speaks the domain's role names, and its allow-lists are documented as presentation
- [x] Logins for the demo (D-5): one per member of staff and one client, provisioned by the seed through `UserRepository` — never through a sign-up endpoint, which is disabled. Better Auth is asked only for the password hash and the `accounts` row that holds it
- [x] Verified against Neon in the browser: a signed-out visit to `/cases` redirects with `?next=`, the API answers 401 with no cookie, a wrong password is refused as a sentence beside the form _and recorded_ as `session.refused`, signing in lands on the page originally asked for, a status move appears in the trail as `status: New → Active`, the portal shows one client's matters and one client's fee notes, `/api/cases/{another client's matter}` answers `NotFound`, `/api/clients` returns exactly one row, and a Finance Officer is refused the audit trail

> **The bug the browser found that the tests did not.** The audit row→entry
> mapping decoded through `AuditEntry` rather than `Schema.typeSchema(…)`, so it
> expected the _encoded_ form of an `Option` — `{"_tag":"Some"}` — where a row
> holds a nullable column. Writes were unaffected because they go the other way,
> the in-memory repository has no mapping at all, and the schema tests attack
> constraints rather than round trips: a one-directional mapping tested in one
> direction passes. `audit-model.test.ts` now runs a row through both.

> **What is deliberately still outstanding.** Two things, both stated rather
> than quietly skipped. **A password reset link is logged, not emailed** —
> there is no mail transport until Phase 7, and on a deployment where logs are
> read by more people than mailboxes are, that is a reset anybody with log
> access could complete; it is acceptable here and would not be anywhere real.
> **`BETTER_AUTH_SECRET` is set for production and development on Vercel and
> not for preview**, because the installed CLI (54.3.0) refuses the
> all-branches form and will not scope a preview variable to `main`. Trunk-based
> development means there are no preview deployments today; the first branch
> that creates one needs the variable, or `vercel@latest` and one command.
>
> Documents, hearings, tasks and the rest of the portal's own screens are still
> the wireframe's mock data. That is Phase 7's, and the seam still says so in
> the UI.

**Done when:** a portal user cannot reach another client's data by any route,
proven by tests, and every mutation is audited.
**Demonstrates:** security thinking, and that you test the negative cases —
which is what separates senior from mid-level.

---

### Phase 7 — Breadth: the remaining modules · 8–12 days

Now grind out the rest, module by module, each a full vertical slice with tests.
Order chosen by domain value: money and deadlines first.

- [x] **Billing** — the whole module through the stack: raise a fee note, record a payment, receive client money, settle a fee note out of it. `BillingService` gained the write path and `TrustRepository` joined the runtime, so this application can now move client money at all — which is why `trust:write` stopped being a permission nobody holds
  - [x] **M-Pesa reconciliation, as three things rather than a text field.** A confirmation code is a branded ten-character value; an M-Pesa payment structurally cannot exist without one, because the domain, the wire schema and the form all apply the same exported predicate rather than three copies of it; and **the same code cannot be banked twice**, enforced by a partial unique index and translated back into `PaymentAlreadyRecorded`. Partial on purpose — two cheques sharing a client's reference are ordinary, and a constraint over the whole column would refuse them
  - [x] The rule surfaced a falsehood in the seed, exactly as `KenyanPhone` did in Phase 2: every payment was being written with a synthetic `INV-3001/1` reference regardless of method, so an M-Pesa payment carried something no statement could reconcile. Codes are supplied in `MPESA_CONFIRMATIONS`, marked as invented, and an unlisted M-Pesa fee note now fails the import rather than defaulting
  - [x] **Migration 0006 adds the `CHECK` as `NOT VALID`**, which is the tool for this and is routinely mistaken for switching a constraint off. Every new and updated row is checked; only the one pre-existing bad row is left alone — because the system does not know what that transaction's code was, and writing a plausible one turns an obviously-wrong value into a convincingly-wrong one. 0007 validates it once the seed has corrected the row at source
  - [x] `recordPayment` is an **append**, not `save` with the payment added. `save` replaces an invoice's payments wholesale, so two clerks banking two cheques at once would each write their own list and the second would silently discard the first — a payment the client made and the firm's books deny
  - [x] Three ways money moves, kept as three operations, because the Advocates (Accounts) Rules turn on which one it is: a payment is the client sending money in, a deposit is client money that stays the client's, a settlement is the firm transferring its costs out under Rule 9. `settle` takes no `reason` — the purpose is fixed, and offering the choice would be offering a way to label a costs transfer as a refund
  - [x] Separation of duties: an ordinary Advocate holds `trust:read` and **not** `trust:write`, so the fee-earner who raises a fee note cannot also pay it out of their own client's money. The permission test asserts the two holders by name
  - [x] `Receivables.trust` is **absent** rather than empty for a caller without `trust:read`. An empty list says the firm holds no client money; that is a very different claim, and on a reconciliation screen it is the dangerous one
  - [x] **Three real bugs, found in the browser, each now a test.** `isUniqueViolation` read `cause` one level down — right for a write outside a transaction, wrong for one inside, so a duplicate confirmation came back as "the database refused the write". `fromPayment` handed `sql.insert` an `Option` and a raw `Date`, so a payment with a reference failed outright and every payment date went round the `CalendarDate` encoding that exists to stop dates drifting a day. And the `audit_action` enum had never heard of `invoice.settled`, so the first settlement was refused — **and the money was rolled back with it**, which is Phase 6's guarantee working rather than a second bug. A drift guard now compares the domain's `AUDIT_ACTIONS` against the enum in both directions
  - [x] 26 service tests over in-memory repositories that **enforce Rule 10 themselves**, via the domain's own `recordWithdrawal` — a fake that accepted an overdrawn settlement would make the suite pass and production fail. 9 API tests through the generated client. 11 integration tests against real Neon, where atomicity actually means something
  - [x] Verified against Neon in the browser: the receivables and the client account read real rows with every figure derived, an M-Pesa payment with no code is refused at the form with the message against that field, a confirmation already banked is refused with the sentence the domain composes, a 200,000 settlement against a 120,000 balance is refused citing r. 10, and a 120,000 settlement writes the payment and the Rule 9 withdrawal together, drops the balance to nil, records `invoice.settled` against the Finance Officer, and removes the settle affordance because there is nothing left to draw on
- [x] **Time tracking** — recording work, correcting it, and the operation the whole module exists for: turning a matter's unbilled hours into a fee note
  - [x] **Phase 1's `TimeEntry` was wrong in two ways, and Phase 7 is where that showed.** It had no identity, which was defensible while nothing could be done to one and impossible the moment two operations needed to name a single entry. And it stored `invoiced: boolean` where the table had stored `invoice_id` since the initial schema — a boolean records that work was billed and loses the only thing anyone asks about it, _on which fee note_, which is a question that arrives exactly once: when a client disputes a bill. The row↔domain mapping is what made it visible, because it could not round-trip
  - [x] **You record your own time.** `record` takes no `advocateId` and there is no way to say otherwise. It costs the partner entering a colleague's hours from a note; it buys a timesheet that is a _first-hand record_ — six hours drafting on the 14th is that person's own assertion, not somebody's reconstruction of it, and in a fee dispute that is the difference between evidence and hearsay. Correcting an entry is the same rule from the other end, and somebody else's entry answers `NotFound` rather than a refusal
  - [x] Work already on a fee note cannot be edited: the client has been told what they are paying for, and changing the entry afterwards makes the invoice and the timesheet disagree about the same hours — which is the discrepancy a taxing master looks for. The remedy is a credit note, which is a visible act
  - [x] **`raiseFromTime` is where the two modules meet, and the race is the interesting part.** `carryOnto` claims the entries in a single `UPDATE … WHERE invoice_id IS NULL` and returns the count; the service checks it got everything it asked for and **fails the transaction if not**. Without that check the loser of a race would raise a fee note for twelve hours having claimed none of them, and the client would be billed twice by two invoices that each look perfectly correct
  - [x] Lines are grouped by activity **and rate** — `Drafting, 12.5 hours at 20,000` — because forty narratives is not a bill anybody can read, and because grouping by activity alone would price a partner's hours at a paralegal's rate. Quantities stay in hundredths so the multiplication is integer cents
  - [x] The form takes a start and an end because that is how a person records a day; the domain stores minutes only. The conversion happens once at the boundary, and the schema is honestly **decode-only** — `encode` returns `ParseResult.Forbidden` rather than throwing, because minutes cannot be turned back into clock times without inventing the time of day. That also keeps its `Context` at `never`, which a `throw` does not
  - [x] `time:read` and `time:write` are separate grants, and a **Finance Officer holds only the first**: a fee note is built from recorded time so finance must see it, and recording it is the fee-earner's act
  - [x] The screen's headline figure is **work in progress** — billable hours recorded and not yet invoiced, by matter, largest first, each with the button that turns it into a fee note. A timesheet is a list; this is the number a small practice usually cannot produce at all
  - [x] The seed adapter closes three gaps by _failing_ rather than defaulting: a rate absent from `HOURLY_RATES` (a default of zero silently turns an afternoon into free work), a missing narrative (it is what a client reads if the bill is challenged), and firm-admin time with no matter at all, which is dropped with a stated reason rather than attached to an arbitrary file
  - [x] **The Phase 7 rule this established: a new `AuditAction` is a migration.** The enum refused `invoice.settled` once already; the drift guard added then compares `AUDIT_ACTIONS` against the enum in both directions, and it caught `time.recorded` in milliseconds instead of on the first write. 18 service tests, and the claim's atomicity asserted against the fake for the service's reaction and against real Postgres for the guarantee
  - [x] Verified against Neon in the browser: the timesheet reads real rows with utilisation and billable value derived, work in progress lists five matters, billing OKL-2026-014 produces INV-3007 with one grouped line at the partner's rate, the entry is marked billed, the matter drops out of work in progress, and unbilled value falls by exactly the amount billed
- [x] **Clients** — intake, correction, contacts, and the conflict screen that runs before a retainer is accepted
  - [x] **The conflict screen was written in Phase 1, exhaustively tested, and had never been run.** `conflicts.screen` takes `MatterRecord` values carrying structured parties and **nothing produced one**: the only record of the other side was `cases.title`, free text of the form "X v. Y", which is what a screen prints rather than something a query can match. A module can be fully covered and still be unreachable, and the row↔domain mapping is what made it visible — the model could not round-trip
  - [x] **Migration 0010** gives `Case` an `opposingParties` array. A `text[]` rather than a party table, deliberately: the screen matches on normalised _names_ and never needs a party's own record, and a table would force a decision about what an opposing party is when they are also a client — which is exactly the question the screen exists to raise for an advocate rather than answer on its own authority. Empty is legitimate and common (a conveyance, a probate application), so the column is `NOT NULL DEFAULT '{}'` and the domain models it as an array rather than an optional
  - [x] The `CHECK` was first written as `NOT EXISTS (SELECT … FROM unnest(…))` and Postgres refused it — a check constraint has to be decidable from the row alone. `'' <> ALL(opposing_parties)` says the same thing and is. It catches the empty string and not `'   '`, which is not a gap: `NonEmptyTrimmedString` refuses a whitespace-only name outright, so this is the backstop for a fix-up script and covers what a script would plausibly write
  - [x] The seed **derives** the opposing party from the title rather than inventing one — the information is genuinely there, badly shaped, and recovering it is not the same as supplying it. Titles with no `v.` yield nothing, which is right for a tax objection or a probate application. `"Republic v. David Odhiambo"` yields `Republic`, correctly, because the derivation takes the side the client is _not_ on rather than assuming the client comes first
  - [x] **The screen still does not decide, and the API says so.** There is no `hasConflict` field and there never will be: the LSK test is whether representation would be "materially and adversely affected", a judgement about a specific retainer. `mattersSearched` crosses the wire because an empty finding list is a statement about the records searched — "nothing across 1,240 matters" and "nothing across 3" are different claims. `concern` crosses as a _sentence_, which is the opposite of every failure in this API: it is professional guidance the domain wrote for an advocate, not a refusal explaining itself, and a client that rephrased it would be rephrasing advice
  - [x] **`client.screened` audits a read**, and it is the only one in the system. The rule is that reads are not audited, because a row per page view buries the entries that matter; a conflict screen is not a page view but a professional act performed before a retainer is accepted, and "was a check run, and what did it show" is asked afterwards by somebody who was not there. An unrecorded screen is indistinguishable from one that never happened
  - [x] The screen is an **atom**, not a Server Action, and the client list is a Server Component. That is Phase 5's division applied literally: a directory is a document, and a screen is interaction — somebody types a name, reads the findings, remembers another party, and asks again. `FormDialog` gained `keepOpenOnSubmit` for the one form whose _answer_ is the point and which has nothing to close to
  - [x] Intake preserves the `Client` union rather than flattening it: the segmented control chooses which half is being created, and the corporate half requires a contact because `Corporate.contacts` is a `NonEmptyArray` — a company with nobody authorised to instruct is unrepresentable, and the form makes that visible. The KRA PIN prefix is checked and **not enforced**, which is the domain's own decision restated: a sole trader entered as a company is a conversation, not a validation error
  - [x] Phone numbers are normalised at the boundary. `KenyanPhone` is E.164 and nobody types `+254722445109`; a form demanding it is a form people work around, so `normalisePhone` runs once, where the money forms convert shillings
  - [x] 14 service tests, including the one that surprised: an enquiry from Coastal Freight against Zenith produces **two findings from one matter** — the firm has acted against the enquirer _and_ the proposed opponent is a current client — and the disqualifying one sorts first
  - [x] Verified against Neon in the browser: the directory reads real rows with matter counts, and a screen of "NAIROBI METRO SACCO LIMITED" against "General Innovations Ltd." returned 3 findings across 8 matters — matching through case, punctuation and company suffix in both directions — with the entry in the audit trail carrying the findings and the count
- [x] **Hearings & calendar** — the court diary, and the two ways a court date is actually lost
  - [x] **An adjournment lists the follow-on hearing, in the same transaction.** The domain already made an `Adjourned` with no destination unrepresentable and Postgres said the same with `adjournment_has_destination` — but a design in which recording the adjournment and listing the next date are two separate acts is a design where the second is forgotten at four o'clock on a Friday. `record` writes both rows or neither, and the follow-on inherits the court, the room and the advocate, because an adjournment is the same matter in the same court on a different day
  - [x] **`awaitingOutcome` is first on the page**, above the upcoming list. A hearing whose date has passed with nothing recorded is either an administrative gap or a missed attendance, and the firm needs to know which before the other side raises it; putting the calendar first — which is what a calendar screen normally does — buries the only list that is urgent under the one that is merely useful
  - [x] Three lists from **one read and one clock reading**, so a hearing cannot appear in two of them or in neither depending on how long a second request took
  - [x] What happened in court is **not overwritten**. Re-recording an outcome is a 409, not a silent replacement: the account of a day in court is evidence, and a design that lets it be replaced is one where the replacement leaves no trace of what it replaced
  - [x] A hearing listed **behind today** is refused. It is nearly always a mistyped year, and it would appear immediately in `awaitingOutcome` — indistinguishable from a genuinely missed attendance, which is the one report that must have no noise in it
  - [x] The court is checked with the **same `canFileIn` intake uses**: a magistrates' court that could not have heard the claim at filing cannot hear it now either, and two different answers to that question would be worse than one
  - [x] **`court-columns.ts` extracted.** `cases` and `hearings` both flatten the court union across four columns; copying the exhaustive `switch` would have given the second one a chance to stop being exhaustive when a court is added, which is the mistake a tagged union exists to prevent. `Court.describe` moved into the domain for the same reason — the rank is _part of the name_, because it is what decides what the court may hear
  - [x] **A third real bug, found by the OpenAPI generator: an error is on the wire too.** `AdjournedIntoThePast` and `ListedInThePast` carried `Schema.DateFromSelf` fields, which encode to a `Date` — the exact thing `api/wire.ts` exists to prevent, applied to entities and never to failures. The generator refused to describe them. The rule this establishes: **an error carrying a date uses `Schema.Date`**, and it is enforced at build time rather than on the first refusal that has to be serialised
  - [x] `hearing:read` and `hearing:write` are separate grants, and a **Receptionist holds only the first**: they answer the telephone to a client asking when their matter is next in court, and listing a matter follows from what the court directed rather than from what somebody was told on the phone
  - [x] The seed refuses a hearing before the Tax Appeals Tribunal rather than assigning it to a court it is not before — `Hearing.court` is required where `Case.court` is optional, and that difference is exactly the Article 162 point Phase 2 made
  - [x] `/calendar/[id]` now redirects to the matter. A `Hearing` is a court date _on a matter_, and everything a person wants while looking at one is on the matter file or inline in the diary; the route survives only so old links work, and says so
  - [x] 14 service tests. Verified against Neon end to end: the diary reads six real court dates with the court names carrying their rank, two awaiting an outcome, and recording an adjournment listed the follow-on three weeks on, put it on the diary, moved the original into the recorded list, and then refused to re-record it
- [x] **Documents** — real uploads to private Vercel Blob (D-4), signed URLs, versioning, categories, access control. **Carries Phase 4's deferred `documents` endpoint group**: the repository and the row↔domain mapping have to exist before there is anything for a contract to describe, and they land here
  - [x] **The store is private, and the bytes never pass through the application.** A public blob URL is a permanent unauthenticated grant to whoever ever sees it, which is the last thing a pleading should have. `download` checks `document:read` and the caller's scope and _then_ mints a fifteen-minute signature scoped to one pathname and to reads; the browser fetches the CDN directly. Streaming through a function instead would push a 40 MB bundle across the network twice, per download, for no gain in authorisation — the decision has already been made by the time the URL exists. The cost is stated rather than hidden: whoever holds that URL holds it for fifteen minutes regardless of session
  - [x] Download is a **route handler**, not a Server Action, because what a download needs is an `href` — one that works before hydration, opens in a new tab, and can be middle-clicked. Its refusals are status codes because nobody reads the body: `404` for absent _or_ out of scope, `403` for a caller who may not read documents at all, `502` when the store cannot sign
  - [x] **Bytes before rows, everywhere.** `upload` writes the object then the row, and the seed does the same, because the two failure modes are not symmetrical: an orphaned object costs a fraction of a cent and is invisible; a row pointing at nothing is a document the file says exists and nobody can open. Only one of the two can be atomic, so the cheap failure is the one to choose. The in-memory store **refuses to sign a key it never received**, which is what makes that ordering testable at all
  - [x] **`allowOverwrite: false` is the store's half of "versions are append-only".** The domain refuses to revise a filed document and Postgres refuses a duplicate `(document_id, number)`; without this the bytes would still be replaceable under a version whose row never changed — the row saying v2, 84 KB, uploaded on the 12th, with something else entirely behind it. The seed re-imports by **deleting each key first**, deliberately, rather than reaching for the flag and weakening the guarantee for every caller
  - [x] **Three defects that only a real store could produce, and the fake now models all three.** `access: "public"` on a private store — rejected outright rather than downgraded, and no unit test can hold an opinion about a store it does not talk to. Overwrite refused on the second seed run, contradicting a comment claiming the opposite. And the seeded rows **claimed 65 KB beside a 467-byte object**: the adapter invented sizes so the register would not show one suspicious figure on every row, and nothing objected — the row decoded, the upload succeeded, the download worked. It took fetching all twelve objects out of Neon-plus-Blob and comparing lengths. `sizeBytes` is a fact about the bytes, so it now comes from the bytes, and a test asserts the row and its body agree
  - [x] The prototype had document _records_ and **no bytes at all**, so the seed generates a body per version and uploads it. Seeding rows alone would have manufactured precisely the failure the ordering above exists to prevent. The placeholder says on its face that it is a placeholder — the difference between demo data honest about being demo data and demo data pretending to be a plaint. The register now shows 4 KB held rather than 436 KB, which is less impressive and true
  - [x] Three gaps closed by supplement rather than default: which documents went to court (`filedWithCourt` is what makes a document _fixed_, so defaulting it to `false` asserts the firm has never filed anything), the signature vocabulary (the prototype's `"Final"` for a judgment maps to `Not required` — a judgment is not a document the firm signs — and an unrecognised status is **refused**, not guessed), and the version history, synthesised from the count because the prototype's own `versions` array dates its second entry `"earlier draft"`
  - [x] `document:read` is **the only grant the client portal has ever gained**. A client is entitled to the documents on their own file, which is what a portal is for; the scope keeps them to their own, answering `NotFound` for somebody else's. `document:write` is deliberately withheld: a client uploading to their own matter is a reasonable feature and a different one, needing a quarantine and a review step, and granting the verb first would be a claim the system does not honour — the same reasoning that kept `trust:write` ungranted through Phase 6
  - [x] The upload form drops the file from `values` on a refusal, deliberately: a browser will not let a page re-fill `<input type="file">`, and the alternative is smuggling megabytes into a Server Action's return value. The form says so in a hint rather than pretending otherwise
  - [x] 14 service tests and 11 API tests. Verified against real Neon **and** the real Blob store end to end: the register reads eight seeded documents; an upload through the form stored 190 bytes and attributed v1 to the signed-in advocate; Revise appended v2 at 230 bytes with v1 still listed and still downloadable; File with court fixed the document and the Revise button disappeared; all twelve stored objects fetched through signed URLs with every row size matching its object exactly, and the same object **unsigned answered 403**
- [x] **Tasks** — assignment, priorities, due dates
  - [x] **The last genuinely new table in Phase 7.** Everything else this phase touched already had one from `0001`; tasks lived in a TypeScript array with a string for the matter, a string for the assignee and a string for the due date — three foreign keys the database never got to check
  - [x] **A matter cannot be closed over open work**, and that rule lives in `CaseService.transition` because closing is where it happens. Closing does not _delete_ tasks; it removes them from every list a person looks at. "File the decree absolute", left open on a matter closed last March, is work that will now never be done by anyone — not because anyone decided against it. It is a refusal rather than a warning, which is the arguable part: a warning is dismissed and the tasks are still there and still invisible, while the remedy takes seconds and has to happen anyway. Only on the way _in_ to `Closed`; reopening is not obstructed by what closing left behind
  - [x] **`Done` if and only if there is a completion record**, said three times deliberately — a `Schema.filter` in the domain, `done_iff_completed` in Postgres, and a refusal in the row↔domain mapping. A status column beside two nullable columns is three facts that can disagree, and the disagreement is not hypothetical: it is what a hand-written `UPDATE tasks SET status = 'Done'` produces. There is no endpoint that edits a status directly, so `Done` is reached only by completing and left only by reopening
  - [x] **Assignment and completion have opposite defaults about _who_, and both are right.** The assignee is chosen and checked against the staff list, because work is given to another person deliberately; the completer is never a field, because a completion recorded on somebody else's behalf is a claim about them they did not make. Same reasoning as the timesheet's missing fee-earner dropdown
  - [x] **A task due today is not overdue at nine in the morning.** The boundary is the start of a day, not the moment of asking, and getting it wrong puts false entries in the one list that has to have none. That is also why the work list is split **on the server** from one read and one clock reading: a browser applying its own clock would disagree for every user outside UTC. `later` is derived by subtraction, so the three lists are exhaustive and disjoint by construction rather than by three predicates agreeing
  - [x] `caseId` is an `Option`, and `tasks.case_id` is nullable — deliberately unlike `time_entries.case_id`, which is `NOT NULL`. Unattributed _time_ is a hole in the billing record; unattributed _work_ is just work, and "reconcile the trust account" is the task most likely to matter and least likely to have a file number
  - [x] **`MatterIsClosed` was declared twice**, in the time and task services, with the same tag and the same field — and the API's error table is what caught it: two schemas cannot both be `MatterIsClosed` on one wire, and a generated client branching on `_tag` could not have told them apart. Errors here are part of the contract, so a tag that means two things means nothing. It moved to the domain and gained `attempted`, which keeps each message specific while the tag stays single
  - [x] `Scheduled` is **dropped** rather than renamed. It was never a state of the work — it was the presence of a date, and every task has a due date; the one task carrying it was "Attend hearing", which is a court date the diary owns. Keeping it would have made "how many tasks are outstanding" unanswerable without a convention nobody wrote down
  - [x] **The prototype's own fixtures disagree with each other**, and the import says so: `TASKS` assigns the registry filing to "Clerk - James" and `STAFF` — the same prototype's staff list — contains nobody by that name. Resolved by a recorded decision in `TASK_ASSIGNEES`, not a fallback, because the domain's rule is exactly that work goes to somebody who is actually there
  - [x] A defect the type system could not see: `export const MatterIsClosed = Matter.MatterIsClosed` dereferences a namespace at _module-evaluation_ time, which depends on bundler chunk ordering — it compiled, passed every test, and threw `ReferenceError: Matter is not defined` on the first page load. Construction sites now say `new Matter.MatterIsClosed(…)`; only the erased type alias is re-exported
  - [x] `task:read` and `task:write` are separate grants. A **Receptionist reads and does not raise** — they answer the telephone about what is happening, and carrying out a task is not deciding one is needed. A **Finance Officer holds both**, unlike time, because reconciling the trust account is finance's own work and a system where the person who must do a job cannot write it down is one people keep a second list beside. A portal user holds neither: the work list names who is doing what across every matter
  - [x] 19 domain tests, 28 service tests, 11 API tests, 8 seed-adapter tests and 8 schema tests. Three service tests were **vacuous when first written** — a layer override that never applied, a store the service never wrote to, and a duplicate that asserted nothing its neighbour did not — and were rewritten rather than left green. Verified against Neon end to end: eight seeded tasks split 1 overdue / 7 due-soon, completing one moved the count 8→7 and removed it from the screen, firm work raised with no matter landed in "Later", and closing OKL-2026-005 was refused with "1 task still open" and then **accepted once the work was done** — a 409 and a 200 on the same request
- [x] **Client portal** — case visibility, invoices, secure messaging
  - [x] Home, cases and invoices were already real from Phase 6 — they read the _same_ service operations the firm's screens do, and the scope is the only difference. Two files remained on mock data, and one of them needed a module that did not exist
  - [x] **Secure messaging, built from nothing.** The prototype had `COMMUNICATIONS` — a contact log of calls, meetings and WhatsApp _summaries_ — and importing that as correspondence would have put words in the firm's mouth and made the audit trail say they were _sent_. "Discussed plea strategy" on a phone call is a note somebody made, not something anybody typed to a client. The contact log belongs to the communications module; the thread is seeded separately and says so
  - [x] **The module exists for one report: a client's question that nobody answered.** Not "unread" — a message somebody opened and did not reply to is _worse_, because it looks handled, and every unread badge ever built reports that thread as clear. `waiting()` is the correspondence equivalent of the diary's `awaitingOutcome`, and both exist because the failure is silent. A run of chasing messages counts as **one** conversation waiting, timed from when they first asked: counting them separately would make a queue of ten look like thirty and be ignored within a week
  - [x] **`message:write` is the portal's first and only write, ever**, and the asymmetry with `document:write` is the argument for both. A portal whose client cannot write is a notice board, and refusing it pushes the conversation onto email — unencrypted, unattributed, outside every guarantee this system makes. A message needs no quarantine: it is text landing in a thread the firm reads. A document enters the matter _file_ — the thing filed at court and relied on — and a file anybody may add to needs a review step that does not exist. So the portal's document upload form was **deleted** rather than wired up
  - [x] **The author is a tagged union, not a nullable id.** A message from the firm names the advocate who wrote it; one from a client names _nobody_, because the portal login belongs to an organisation and inventing an individual would attribute words to somebody who may not have written them. The two sides genuinely carry different information, and `author_is_consistent` is the schema's copy of that — a single nullable `advocate_id` beside a boolean would let a row claim both or neither
  - [x] **Append-only, enforced by a trigger**, like the audit trail. Neither side can edit or withdraw what was said; a correction is a new message. `read_at` is the sole permitted update and only once — "when did you first see this" has one answer, and overwriting would make a message look freshly seen on every page load
  - [x] `ON DELETE RESTRICT` on **both** foreign keys, where every other child table in the schema cascades. `case_id` was first written `ON DELETE SET NULL` — which reads as the gentle option and is not: nulling the column is an _edit_, which the append-only trigger refuses, so the delete failed with a confusing error from the trigger instead of a clear one from the constraint. A schema test found it. Correspondence pins the client and the matter, and goes only when somebody deletes it deliberately
  - [x] **Reading a thread as staff marks the client's messages seen; reading it as the client does not.** That asymmetry sounds obvious and is exactly the bug a single "mark this thread read" produces — a client refreshing the page would quietly empty the firm's queue, and the waiting report would be empty for precisely the clients who were waiting. The client file says so on screen: "1 message was unread until you opened this page"
  - [x] `unanswered` is one `DISTINCT ON` query rather than a fold in memory, because the fold would pull the firm's entire correspondence history into the application to produce six rows — on a screen somebody opens every morning. The in-memory fake reproduces the rule by calling the domain's own `awaitingReply`, so the SQL and the fake agree because they encode the same rule rather than because someone translated it twice
  - [x] `MatterIsNotTheirs` is a 422 and not a 404 — the one place in this system where a mismatch is _not_ concealed. Scope answers `NotFound` because confirming a record exists is itself a disclosure; here the sender can see both the client and the matter and has simply put them together wrongly, and "not found" for a matter plainly on screen would be baffling rather than discreet
  - [x] The composer is **one component used by both sides** — one action, one author rule, no chance of the two drifting — but the _copy_ is not shared: it said "Type a message to your advocate…" on the firm's own client file until somebody read it there, which is the sort of thing only a screen shows
  - [x] 16 domain tests, 22 service tests, 11 API tests, 6 seed-adapter tests and 13 schema tests. Verified against Neon end to end: the client's thread showed their own messages as "You" and the firm's by name; a client message sent and cleared the field; opening the client file as the partner reported "1 message was unread until you opened this page" and did **not** say it again on reload; the firm replied and the client left the waiting queue; and Wanjiku remained on it at "Read, and not answered · 6 days" — the exact case an unread badge would have shown as clear
- [x] **Communications, notifications, knowledge base, HR, users** — lighter slices
  - [x] **Notifications has no table, and that is the design.** Every notice is a restatement of a fact that already exists — a hearing on Thursday, a task overdue since Monday, a fee note past due, a client waiting on a reply. Storing copies means writing one when the fact appears, updating it when it changes and deleting it when it resolves; the familiar failure of every notification inbox ever built is that middle step going missing. A derived feed cannot go stale, because the notice _is_ the fact. What is given up is stated rather than hidden: no read state and no history, and the table worth building the day somebody needs them stores _dismissals_ — a fact about a person — rather than copies of facts about the firm
  - [x] `NoticeService` composes four other services and owns no data. **Each source may refuse, and a refusal means "nothing from there"** rather than an error: a Receptionist gets the court diary and none of the money, a Finance Officer the mirror image, and neither rule is restated here. A role that gains a permission gains its notices with nothing to change. It is also the first service to require others, which is the one Layer mistake this codebase can still make silently — a merged layer satisfies the same tags, so `mergeAll` where `provideMerge` was meant compiles and fails at runtime
  - [x] **`staff:read` gets its first operation**, having been granted since Phase 6 with nothing behind it — the state `trust:write` was in until Phase 7 and `conflicts.screen` was in until a matter gained `opposingParties`. And with it, `Firm.certificateLapsed` — written in Phase 1, never once called. `mayAppearInCourt` has refused to _assign_ a matter to an advocate without a current practising certificate since Phase 2; what never existed was the **list**, so the firm found out at intake, one matter at a time. The check is now stated on the page even when it passes, because a section that vanishes when empty is indistinguishable from a feature nobody built
  - [x] **The contact log is not the message thread**, and the schema says so. `messages` is correspondence _through_ this system — the words are held, both sides saw the same ones, neither can change them, and a trigger enforces it. `contacts` is a note _about_ a call or meeting the system never saw: somebody's summary, written afterwards. Evidence versus testimony, and `contacts` deliberately has **no append-only trigger** — a summary written from memory is exactly what should be correctable, and giving it a record's weight would be a claim nothing supports. A reader should be able to tell from the DDL which one holds up in a dispute
  - [x] `direction` is recorded and the prototype did not record it. "Did we chase them or did they chase us" is the first question anybody puts to a contact log, and one that cannot answer it is a list of events rather than a record of a relationship. Defaulting to `Outgoing` would claim the firm initiated every conversation it has ever had — flattering and untrue — so each entry is decided in the supplement and an unlisted one stops the import
  - [x] **The reports are the point of both new tables.** `neglected` — clients with open matters nobody has been in touch with — because a log of what _did_ happen is a diary, and the absence of an entry is invisible in a list of entries. `needsReview` — precedents nobody has verified in a year — because a bank's failure is not being empty, it is being stale, and a 2019 annotated Act looks exactly like a current one in a list of titles. A year is the interval because Kenya passes a Finance Act annually
  - [x] **Three things were removed rather than wired up**, on one principle: a form where every field is inert is a form that lies. Firm _settings_ offered a currency, a timezone, a date format and notification channels, and **nothing in the system read any of them**. "New user" added a name to a browser store while the real login table sat untouched — sign-up is closed (D-5), and provisioning needs a credential. Leave balances were a number with no source, and a wrong leave balance is worse than none because somebody books a holiday against it. The same reasoning removed the portal's document upload in the previous slice
  - [x] The users page now **generates the permission table from `BY_ROLE` itself**, replacing a hand-written sentence per role in `lib/nav.ts`. A description of permissions written separately from the permissions is one that goes wrong, on the page whose whole purpose is to be trusted about what a role can reach. `permissionsForRole` was added for it — `permissionsOf` takes a _principal_, and asking it "what does this role mean" meant inventing a fake person, which is a cast around a type that was telling the truth. The page was also opened from System-Administrator-only to every staff role, because what it _is_ changed: a directory and a permission table, with nothing privileged left on it
  - [x] `MatterIsNotTheirs` moved to the domain **before** it was declared twice, applying Phase 7's own `MatterIsClosed` lesson in advance rather than after the collision
  - [x] The append-only trigger refused the seed's `DELETE FROM messages`, correctly. The wipe uses **`TRUNCATE`** — not a loophole but a different operation at a different level, meaning "empty this table" rather than "remove these rows". Disabling the trigger for the seed would have been the escape hatch that makes the guarantee worthless
  - [x] Two supplement decisions made so the reports are demonstrable rather than empty: the prototype's six log entries name all six clients within one week, so two are dated back; and some precedents are seeded with **no review date at all**, because supplying one for everything would make the staleness report empty and the module invisible. Both marked as supplied, like `HOURLY_RATES` and `FILED_WITH_COURT` before them
  - [x] 15 domain tests, 41 service tests across three new services, 13 schema tests. Verified against Neon: the notifications feed drew six pressing items from four modules — two overdue fee notes with real amounts, a client waiting six days "read, and not answered", two hearings with no outcome recorded and an overdue task; the contact log showed direction and matter per entry with Coastal Agro quiet 129 days and Grace Njeri 101; the precedent bank flagged two never-reviewed entries and left three current ones alone; HR showed real workloads with "—" for non-advocates; and the users page rendered all six roles' actual grants
- [x] **Reports** — aggregate queries, financial summaries, exports
  - [x] **The one place in this system where aggregation belongs in the database**, and the contrast with the two slices that went the other way is the argument. The precedent bank filters _in the domain_ because a firm's bank is tens of rows; the notice feed composes _in a service_ because every fact it shows already has an owner. An ageing schedule over three years of fee notes is neither — reading every invoice, line and payment into the application to produce five numbers means the whole billing history crossing the network so one table can be drawn
  - [x] **The cost is that money is now computed twice**, in TypeScript and in SQL, which is the arrangement this codebase avoids everywhere else. It is paid for with one mitigation that is not optional: **the rounding happens per line, not per invoice**. `SUM(round(unit_price_cents::numeric * quantity_hundredths / 100))` is what `Billing.lineAmount` does; `SUM(unit_price × quantity) / 100` is not, and the two agree on round numbers while differing by a cent on every hourly rate that is not a multiple of a hundred. `::numeric` and never `::float8` — a float would reintroduce exactly the drift `Money` exists to keep out
  - [x] `report-repository.integration.test.ts` asserts the two agree **to the cent against real Postgres**, on fixtures engineered so every single line leaves a remainder. Moving the `round()` outside the `SUM()` fails exactly that test. The firm-wide assertions are written as **deltas** — settle a fee note, check the schedule falls by that amount and the count by one — because the database also holds the seeded dataset and an absolute total would be comparing the whole firm against four fixtures
  - [x] Ageing buckets by **due** date, not issue date: a fee note is not late until it is due, and ageing by issue would report every current invoice as thirty days old. Settled fee notes are absent entirely, and an overpaid one is a credit that does not net off somebody else's debt. Every band is returned even when empty — a schedule with "Over 90 days" missing reads as though nothing is that old rather than as though the query said nothing about it
  - [x] **Two bugs found by running the thing.** The first: `PgLive` transforms result column names to camelCase, so a query aliasing `client_id` typechecks happily and reads `undefined` at runtime — the aliases now say what actually arrives. The second was subtler and is the reason exports are worth building rather than assuming: **the CSV was off by one day**. node-postgres parses a `date` into a `Date` at _local_ midnight, so 20 July in Nairobi is 19 July 21:00 UTC and `toISOString()` writes the nineteenth; the screen looked right because `toLocaleDateString` reads the same local fields. `CalendarDate` is the module that exists for precisely this, and the query was reaching around it. Found by opening an exported file and comparing it to the page it came from
  - [x] **A regression from two slices earlier, caught here.** `case-repository.integration.test.ts` built its fixture with `({ … }) as Matter.Case`, and the cast hid a required field: `Case` gained `opposingParties` when the conflict screen was connected, the fixture never grew one, and every save had been failing against real Postgres ever since. The unit suite stayed green because it touches no database, and nobody had run the integration suite. The fixture now **decodes** rather than casts, so adding a required field breaks it at the same moment it breaks everywhere else. A second test in that file was stale in the opposite direction — asserting a generic `RepositoryFailure` where the repository had since learned the more useful `CaseNumberTaken`, with a docstring describing a constraint its body never exercised
  - [x] **Realisation, not just utilisation.** Utilisation is billable time over everything recorded — the number every firm quotes. Realisation is billed value over billable value recorded, and it is the one that finds money: low realisation is not a productivity problem, it is work already done and sitting unbilled. Both are computed with `FILTER (WHERE …)` rather than `CASE` inside the aggregate, which says what it means in a query with four sums differing only by their condition
  - [x] **CSV written by hand, and the escaping is why.** A field containing a comma and no quoting shifts every column to its right — a corrupt file that opens cleanly, which is worse than one that fails. And a field beginning `=`, `+`, `-` or `@` is a **formula** to Excel and Sheets: a client named `=cmd|'/c calc'!A0`, or simply one whose name starts with a minus, is code execution on whoever opens the export. The leading apostrophe defuses it, and that is a named vulnerability rather than a nicety. Money exports as a plain decimal and dates as ISO because a spreadsheet has to _add_ and _sort_ those columns — `KES 12,500.00` is text to every one of them
  - [x] The export is a **route handler** with no permission check of its own: `ReportService` refuses anyone without `staff:read` and omits the money sections from anyone without `invoice:read`, so a second copy of the rule here is a second copy to forget. A section the caller may not see is a `403` rather than an empty file — an empty CSV looks like a firm with no debtors, and somebody will act on it
  - [x] Gated on **`staff:read`**, which is not the obvious choice and is the right one: it means "you work here", every staff role holds it, and no portal user does — `case:read` would have been intuitive and a portal user holds it. And a _scope_ check would be wrong in a different way: narrowing a firm-wide total to one client does not produce a smaller report, it produces a false one
  - [x] 13 service tests, 11 CSV tests, 7 integration tests against real Postgres. Verified in the browser: Ksh 655,000 outstanding across two bands, six months of billed-against-collected with the collections landing in the month received, three debtors longest-owing first, three fee earners with utilisation and realisation, and `debtors-2026-08-21.csv` downloading with a date-stamped filename, a UTF-8 BOM, plain-decimal money and ISO dates that **agree with the screen**
- [x] **Global search** across cases, clients, and documents
  - [x] **The endpoint most likely to leak, and the design says so.** Every other read is about one kind of thing and is scoped where it is written; search spans five tables at once, and the tempting implementation — one `UNION ALL` filtered afterwards — is the shape that puts another client's matter in front of a portal user the first time somebody forgets a `WHERE`. So the scope is a **parameter of every query**: `visibleTo` is required, has no default, and there is no overload without it, which is the same reasoning as `CurrentUser` sitting in the `R` channel of every service operation
  - [x] **Two independent limits, and both are needed.** _Permission_ decides which kinds are searched at all — a Receptionist's fee notes are never queried, not queried and filtered, because a search that read the rows would still have read them. _Scope_ decides which rows within a kind. The failure modes differ: without the first, a Receptionist searching a client's name learns what the firm has billed them; without the second, a portal user searching their own name finds every other client with a similar one
  - [x] **Not full-text search**, and the reason is what people actually type. `tsvector` is built for prose and this is not prose: a law firm's system is searched for _identifiers_ — `OKL-2026-014`, `INV-3002`, `HCCOMM E0091 of 2026` — which a text-search configuration tokenises into pieces that do not match what was typed. Stemming actively harms a name: `Wanjiku` and `Wanjiru` are different people. `ILIKE` on indexed columns, ranked so an exact identifier beats a prefix and a prefix beats a substring, is simpler and better suited. Fuzzy matching wants `pg_trgm` and is a separate decision — an extension, an index per column and a threshold somebody has to choose, none of it worth doing before anybody has complained about a missed spelling
  - [x] **Ranking happens in SQL because `LIMIT` does.** Sorting in the application would sort a list the database had already truncated, which puts the best match on the page nobody looks at. Each kind gets its own limit, so a client with two hundred documents cannot push every matter off the results — the single ranked union would do exactly that, and search becomes useless for everything else
  - [x] **Matters are searchable by the party on the other side.** "Who else have we acted against" is how a conflict gets noticed by somebody who is not running a formal screen — and `opposingParties` is the column the conflict module needed before it could run at all, added three slices earlier for that purpose and now earning a second one
  - [x] Documents are scoped **through their matter**, which is the join a one-query search gets wrong: `documents` carries a `case_id` and not a `client_id`, and the version that forgets that hop returns every document in the firm. The in-memory fake applies the scope too, deliberately — a stub that returned everything would let the portal tests pass for the wrong reason, asserting against the fake rather than the code
  - [x] A term below two characters is answered with "keep typing" rather than a list: `%a%` against four tables returns most of the firm, which is slow _and_ useless, and an empty result would read as "nothing found". The page also says **what was searched**, so a Receptionist who finds nothing knows the fee notes were never looked at
  - [x] A page at `/search?q=…` rather than a dropdown under the box. A type-ahead panel is nicer for the case where the first hit is right and worse for every other — it cannot be linked, it vanishes when the mouse moves, and it costs a request per keystroke. The box is a plain GET form, so it works before hydration, and it keeps the term because refining a search is the commonest thing anybody does with one
  - [x] The masthead's notification badge stopped counting a mock array and now counts the **derived** notice feed, hiding entirely at zero rather than showing a "0"
  - [x] 17 service tests. Verified against Neon in the browser: "Zenith" found the matter and the agreement across two kinds; "Nairobi Metro" found the matter through its opposing party; the badge showed 7 from real records. A portal user is redirected off the route by `proxy.ts` before the service is reached — defence in depth, the same as `/documents` — so the scope tests cover a case no route currently exercises, which is correct: scope is enforced at the service boundary because the route tree is an affordance and the service is the rule

- [x] **Appointments** — the office diary, and the clash check the module exists for
  - [x] **The clash check reads the court diary too, and that is the whole reason the table earns its place.** An advocate cannot be in two places at once, and the booking that actually goes wrong is a consultation at ten o'clock on a morning somebody is already in court — the date was set weeks earlier by somebody else, and whoever answers the telephone cannot see it. `schedule` reads the advocate's appointments _and_ their pending hearings for that day and refuses an overlap with either. A check that knew only about appointments would miss the one clash that matters most, and would miss it silently
  - [x] A hearing has **no end time** — courts do not publish one — so it is treated as occupying three hours. Stated as an assumption rather than buried: generous rather than precise, on the grounds that a false clash costs a conversation and a missed one costs a client. A recorded hearing is over and does not block, which is `pending()` rather than `all()` and is a test
  - [x] **Refused, not warned**, on the same reasoning as closing a matter over open work: a warning is dismissed and the booking is still wrong, and the remedy takes seconds. The refusal **names the collision** — "Adv. Sarah Wanjiru is already down for Mention · OKL-2026-014" — because "that time is not free" sends somebody hunting through a diary they cannot see
  - [x] Overlap is **half-open**, so back-to-back consultations are allowed. A naive `from <= other.to` refuses them, and a system that refuses them is turned off within a week
  - [x] **Minutes, not an end time.** A start and an end are two facts that can disagree the moment somebody edits one, and an appointment ending before it begins is otherwise representable. The form asks how long it runs, from a fixed list, because free minutes invites `0`, `-30` and `480` — and the domain refuses the first two while accepting the third
  - [x] **"Court appearance" is deliberately not an appointment type**, and the prototype had one. That is a hearing: it has a court, a cause number and an outcome somebody must record, none of which an appointment can hold. Offering it here would put a court date in the one place the calendar cannot see it — the exact failure this module was built to prevent. The seed **refuses that row by name** rather than skipping it quietly
  - [x] **No audit entry, and that is a decision rather than an omission.** The trail records acts with consequences outside this system — money moved, a document filed, a message sent. A diary entry is an arrangement between people that they will change by telephone, and recording every booking would bury the entries somebody will one day need to find
  - [x] Gated on `hearing:write` rather than a permission of its own: booking a client meeting and listing a court date are the same act, performed by the same people, and an `appointment:write` held by exactly the roles that already hold `hearing:write` is a distinction with no difference — one more row in a table whose value is that every row means something. `upcoming` is `staff:read`, so a client is **refused rather than shown an empty diary**, and the scope branch underneath it was deleted for being unreachable
  - [x] `ON DELETE SET NULL` on `client_id` and `case_id` here, where `messages` uses `RESTRICT` — and the contrast is the point. Correspondence pins the matter it belongs to; a meeting outlives the file it was about, and a diary that refused to delete a closed client would be a diary nobody could tidy
  - [x] 12 domain tests, 20 service tests, 4 schema tests. The service tests are written so a version reading only appointments fails: the advocate's own diary is empty in the court-clash cases
- [x] **Dashboard** — the last two files importing `lib/data`, and the worst of them
  - [x] They were client components merging seeded constants with whatever the in-browser store had accumulated — `[...records.hearings, ...HEARINGS]` — so the home page showed a firm that existed nowhere else in the system
  - [x] **`DashboardService` composes services rather than writing aggregates.** The unpaid count is `BillingService`'s idea of unpaid, the open-task count is `TaskService`'s, the trust balance is the ledger's, and the month's collections are the last bar of the chart on `/reports`. Six fresh `SELECT`s would have been quicker and would have produced a dashboard that slowly stopped agreeing with the pages it links to — a partner reading "6 unpaid" here and counting five on `/billing` has found a bug in one of them and no way to tell which. The cost is more round trips, bounded by the size of a firm, and it buys the property that matters more
  - [x] **The tests assert each figure against the service that owns it** rather than against a literal. A dashboard asserting "6" passes while `/billing` says five; these fail in exactly that case
  - [x] **A band drops on its own rather than taking the page with it — found by the tests.** The first version called `hearings.diary()` unguarded, so the refusal propagated and a Finance Officer, the one role that most needs the money band, got an error page. Only `NotPermitted` is swallowed: a repository failure still fails the screen, because a dashboard rendering zero when Postgres is unreachable lies quietly, and that is worse than an error
  - [x] **A missing band is not a zero.** A Receptionist sees no money at all rather than "Ksh 0", which would be a statement about the firm rather than about the reader — the same reasoning as `Receivables.trust` being absent rather than empty
  - [x] An advocate's band counts **their own** matters while the firm's charts stay the firm's. The prototype scoped by matching the signed-in person's _name_ against a string column; this uses their advocate id, through the caseload filter the caseload screen already uses
  - [x] The masthead was a client component only because it needed the signed-in role, which is now a server read. Nothing on the page needs the browser, so nothing on it ships to one
  - [x] 22 service tests
- [x] **`lib/data/portal.ts` deleted.** Its five functions invented a client's matters, documents, invoices and messages, and every portal screen now reads a service. What survived was `PORTAL_NAV`, which is not mock data but the same kind of thing as `NAV_SECTIONS` — so it moved to `lib/nav.ts` and sits beside it

  **Status:** Phase 7 complete. The gate is met — `grep -rn 'from "@/lib/data' src/app/`
  returns nothing, down from 28 files at the start of the phase. 942 unit tests and
  49 integration tests pass, and every slice was verified against real Neon in the
  browser before its commit. `src/lib/data/*.ts` still exists and is still read by
  the **seed adapters**, which is what it is now for: the prototype's fixtures are
  the demonstration dataset's source, decoded through the domain schemas rather
  than rendered directly.

**Done when:** no `src/lib/data/*.ts` mock imports remain in `src/app/`.
**Demonstrates:** sustained delivery and consistency at scale — twenty modules
built to the same standard is itself the signal.

---

### Phase 8 — Observability and resilience · 2–3 days

- [x] **OpenTelemetry tracing via `@effect/opentelemetry`** — one trace per request, not two
  - [x] **`Tracer.layerGlobal`, not `NodeSdk.layer`**, and the difference is the whole slice. Next is already instrumented: it opens a span for the request, one for the route render, one for every `fetch`. A tracer provider built inside `AppLayer` would export a _second, parallel_ trace containing only the Effect half — `CaseService.open` with no request above it, and `GET /cases` with nothing underneath. Both real, neither able to answer where the two seconds went. `instrumentation.ts` registers the provider through `@vercel/otel` before the first request is served, and Effect's tracer is built from that same global one
  - [x] The nesting works because `@effect/opentelemetry` falls back to the **active OpenTelemetry context** when a fiber has no Effect parent span — which is exactly the situation on the first `yield*` inside a Server Component. `tracing.test.ts` registers a provider the way `register()` does and asserts the spans arrive in it, nested, attributed to `oklaw` at the deployed commit. That test is the only reason to trust the wiring, because the failure it rules out throws nothing
  - [x] **No vendor's name is compiled in.** `registerOTel` picks the exporter from the environment — a tracing integration on the Vercel project, or the standard `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS`. Pointing this at Grafana Cloud, Honeycomb, Dash0 or a collector on a laptop is two variables and no deployment. **The free-tier account is not provisioned** — that is a click in somebody's browser, not a line of code, and it is the one part of this bullet that is configuration rather than software
  - [x] With nothing configured, `trace.getTracerProvider()` answers with a no-op and spans are created and dropped. Which is why there is no flag to turn tracing off: a flag would be a second way for it to be silently absent
- [x] **Structured logging with request correlation IDs** — and the id is the trace id
  - [x] Threading a request id through every signature works and is what most codebases do; in practice it reaches the code somebody was debugging that week and nowhere else. There is already an identifier with exactly the right lifetime, so the logger **reads** the current span out of the fiber's `FiberRefs` rather than being handed one. Nothing is threaded anywhere, a line written four layers down carries the same id as the line at the boundary, and it survives a fork — the case a hand-threaded id always loses
  - [x] Outside a request the fields are simply absent. An id invented for a line with no trace behind it joins to nothing, which reads worse than an empty field
  - [x] JSON on a deployment, logfmt on a laptop, and the default follows `VERCEL_ENV` rather than a variable somebody has to remember. A log drain parses JSON into fields you can filter on and treats a pretty-printed line as a string you cannot
  - [x] **`withLeveledConsole`, and it is not cosmetic.** Vercel classifies a line by the stream it arrived on, and Effect's own `Logger.json` writes everything to stdout — so a `logError` would be an error that never appears in the error view
  - [x] **The fourteen `console.error` calls are gone**, and what replaced them is not a tidier version of the same thing. They only fired for failures somebody had thought to single out: a `StorageFailure` from a document upload went to the screen as a sentence and to the log as nothing at all. `reported` sits inside `attempt` and `attemptAs` and grades every typed failure — a broken dependency is an error, a `NotPermitted` is a warning (a screen offering a button the role may not press, or somebody trying doors), and every other refusal is debug, because "a claim beyond the court's limit" is the product working and logging it at `Info` would bury the first two categories
  - [x] Deliberately **not** inside `run` and `runAs`: a failure that rejects reaches `onRequestError` with the route it happened on, while a failure turned into an `Either` is rendered as a sentence and then gone
- [x] **Retry with exponential backoff on transient DB failures** — three classes, not one
  - [x] Neon scales its compute to zero and closes idle connections routinely. Neither is a fault, and both mean the first page load after lunch can meet `ECONNREFUSED` on a healthy database. The difficulty is that "retry on transient errors" is one step from "post the payment twice"
  - [x] A retry is only safe when you can say what the previous attempt **did**, and there are exactly three answers. _It never ran_ — the connection was refused, the pool was full, Postgres was starting. _Postgres rolled it back_ — a deadlock or a serialization failure. _Nobody knows_ — the connection dropped mid-statement, or the attempt was abandoned on a timeout
  - [x] **The first two are safe for anything; the third is safe for reads and not for writes.** `reading` replays on it, `writing` does not. That asymmetry is why this is a module rather than one `Effect.retry` in `client.ts` — a single policy has to pick one behaviour for everything, and both choices are wrong somewhere. `08007` sits in the unknown set despite sharing its class with codes that are safe, because the class is not the criterion: what the attempt might have done is
  - [x] Jittered, which matters more than it sounds: Neon waking refuses every connection for the same few hundred milliseconds, so an unjittered policy retries in lockstep and stampedes a database that has just come up
  - [x] `Transactor` gains `contended`, covering the one failure the statement-level retries cannot — a deadlock aborts the transaction, so retrying a _statement_ inside it re-runs it in a transaction that no longer exists
  - [x] Operation names are now qualified — `CaseRepository.byId` rather than `byId` — because the same string is the span name in a trace and the operation in a log line, and eight repositories have a `byId`
- [x] **Timeouts on every external call** — Postgres, Vercel Blob, Better Auth
  - [x] The failure a budget exists for is not a slow call, it is a socket that accepts the request and never answers. There is no error to catch; the promise simply never settles, and the request holds its connection, memory and concurrency slot until the platform kills the function 300 seconds later
  - [x] The durations differ because the calls do. Signing a blob URL is two small control-plane requests; uploading forty megabytes of pleadings is not; hashing a password is _deliberately_ slow. One budget generous enough for the upload lets the signature hang for half a minute
  - [x] `SessionGateway.identify` gets the tightest of the four, because it runs on **every request** — a hang there is not a slow sign-in, it is the application unresponsive
  - [x] `signOut`'s budget sits **inside** its `orElseSucceed`. Outside it the timeout would be swallowed, and a sign-out that hung and then reported success leaves a cookie nobody knows the browser still has
  - [x] A timeout stops _waiting_; it cannot cancel a promise. Which is exactly why the retry policy treats one as "nobody knows what happened" and will not replay a write on the strength of it
- [x] **Rate limiting on the authentication endpoints** — without handing out lockouts
  - [x] **No counter is keyed on an account alone**, and that is the property the whole design turns on. Every advocate's address is on the firm's website; a per-account limit hands anybody who can read it a way to lock a partner out of their own files on the morning of a hearing, five wrong passwords at a time. Both buckets include the source, so an attacker can exhaust their own attempts and nobody else's
  - [x] Source-and-account together (5) stops one host working a password list against one advocate. Source alone (20) stops the same host trying one or two guesses against many addresses, which is what a stuffing list looks like and which the narrow bucket would never notice. **A botnet with a fresh address per attempt defeats both** — nothing keyed on the source can do otherwise, and what raises that floor is a second factor, which this system does not have. Stated in the domain rather than left as an implication
  - [x] **Spent before the password is checked**, asserted by counting the calls the gateway receives. Hashing is deliberately expensive; a limiter consulted afterwards makes an attacker's guesses cost the server and cost them nothing. Writing that test found a bug in the _test_ first: the fake incremented its counter in the function body rather than inside an Effect, so it counted pipelines assembled rather than calls made
  - [x] Counters in Postgres, not a `Map`. On serverless there are several instances with several heaps, any of which may be replaced between two requests — an in-process counter permits some multiple of the intended attempts and forgets everything on a deploy
  - [x] The bucket is stored as a **SHA-256**. Unhashed, `auth_attempts` would be a list of who tried to sign in, from where and when, sitting beside the matters those people are privileged to see and with none of the retention discipline the audit table has. The trail still records refused sign-ins by address, in the place designed to hold that
  - [x] `session.throttled` is its own audit action — **a new `AuditAction` is a migration**, the rule Phase 7 established. A run of `session.refused` is somebody who forgot their password; a `session.throttled` is the control firing, and a review that could not tell them apart could not say whether it had done anything
  - [x] **Found while verifying: Better Auth rate-limits its own endpoints in production** (three per sixty seconds on `/request-password-reset`), which produced a `429` from a limiter this codebase did not write. It does not cover sign-in as this application does it — that is a Server Action, and `handle` refuses `/sign-in/email` outright — and it is stored in memory, which is the control this phase argues is not one. Left enabled as a per-instance second line
- [x] **Health check endpoint and error tracking**
  - [x] `/api/health` is unauthenticated, so it is written on the assumption that anybody who finds it can read it: whether the database answered and how quickly, never why one did not. The commit and the environment _are_ published, deliberately — neither is a secret and "which build is this" is the first question of most incidents
  - [x] `503`, not `200` with a sad body. Whatever polls this reads the status code and most such things never look at the body
  - [x] **The probe's budget was two seconds and measurement changed it to five.** A cold Neon answered in 1,657ms and a warm one in 224ms, so two seconds would have reported `degraded` for a deployment that goes on to serve the page — a health check that disagrees with the application it is checking is worse than none, because somebody is paged for it. Latency is published as `ms` instead. It is not retried, which is the one place in `infra/sql/` that is true: retrying would hide exactly the intermittent fault a monitor exists to catch
  - [x] `DatabaseProbe` is the only store merged into `AppLayer` rather than provided to the services. Every repository is hidden precisely so a page cannot skip the authorization in front of it; this one has no service to go through and its whole interface is `SELECT 1`
  - [x] **Error tracking is `onRequestError`, and not Sentry (D-10).** Until this phase a Server Component failure showed `error.tsx` with a digest and the digest pointed at a log entry that was never written — the screen said "reference 3f9a2c" and the server said nothing. Now the digest, the real message, the stack, the route and the route _type_ are one structured line. `cases/error.tsx` stops logging entirely, because what reaches a client error boundary is not the error that happened: React replaces it with an opaque one carrying only a digest, so printing it told nobody anything while implying the failure had been recorded
- [x] **`TestClock`-based tests for retry and timeout behaviour** — 14 tests, 323ms, no sleeps
  - [x] A retry policy is ordinarily among the least testable things in a codebase, because the behaviour worth asserting is what happens after eight hundred milliseconds of backoff. `TestClock` makes "five seconds elapse" an instruction rather than a wait
  - [x] The assertions are **bounds either side of each jitter range**, not exact delays — a test asserting `50ms` would be asserting the absence of the property the jitter exists to provide
  - [x] The one that matters most: a write whose outcome is unknown is attempted **once**, and the same failure on a read is attempted three times

  **Status:** Phase 8 complete. 1,000 unit tests and 49 integration tests pass,
  no `console.` call remains outside the logger's own sink, and every slice was
  verified against real Neon — the limiter's counters, the health endpoint on a
  production build, and migration 0018 applied. The one thing not done in code
  is provisioning a traces backend, which is two environment variables and an
  account, recorded above and in D-10.

**Done when:** you can trace a slow request end to end, and resilience policies
are proven by tests that run in milliseconds.
**Demonstrates:** production thinking, and the deterministic-testing superpower
that is Effect's best sales pitch.

---

### Phase 9 — Product polish · 3–4 days

- [x] **Formalize the design system** (D-6): the variables are split into **primitives and roles**, `docs/design-system.md` is written, and the editorial identity is intact — every fix below is a step on a ramp the system already defined
  - [x] **A primitive says what a colour is; a role says what it is for, and carries the contrast obligation.** The distinction is the whole slice. Before it there was no answer to "may I use this here", so twenty-four ad-hoc `color-mix` expressions had accumulated across two sheets, at ten different ink strengths, each one locally reasonable
  - [x] **Measuring the ink levels is what turned this from tidying into a bug hunt.** Five transparency levels and `--color-neutral-600` were all being used as text, and they measured between **3.1:1 and 4.2:1** — under the 4.5:1 AA asks for. They were not a hierarchy, they were one role rendered five ways at increasingly unreadable contrast. There are four ink roles now and no fifth, because a light newsprint ground has room for exactly that many readable greys; depth below `--ink-muted` is carried by size, case and tracking, which is what was doing the work anyway
  - [x] **Ink is opaque now, and that is the load-bearing change.** A transparent ink is a different colour on every ground — 55% ink measures 3.65:1 on the page, 3.56:1 on a card, 3.67:1 in a tag — so "does it pass" has one answer per ground and nobody re-measures when a component moves. Each opaque role has one answer, quoted at its worst ground, which is what lets it be used anywhere without re-deriving anything
  - [x] **The primary button was failing at 3.7:1** — the most-pressed control in the application, the brand teal with a near-white label. `--fill-accent` is one step down the same ramp at 5.7:1, which is what a tonal ramp is for. The badge is the counter-example that stopped this being a reflex: it stays `--color-accent-2` because it measures 4.6:1 and **the next step down its ramp is worse at 4.3:1**
  - [x] **Every form control was drawn with a hairline that failed 1.4.11 at 1.4:1.** Not a theoretical bar here: the input fill sits within **1.1:1** of the page behind it, so nothing but the border said where the control was. `--line-control` clears 3:1. Rules between table rows stay hairlines and the test asserts they _fail_ 3:1 — the exemption is written down so nobody later fixes the dividers into a cage
  - [x] **`tokens.test.ts` parses the real stylesheets rather than a copy**, so the figures in the sheet's own comments and in `docs/design-system.md` cannot drift from the values beside them. Three mutations verified it: pointing `--ink-muted` back at the failing ramp step, making one rule name a primitive, and misspelling a token each fail exactly the test written for them
  - [x] **The assertion that found live defects is the dullest one: every `var(--…)` in `src/` must resolve.** An undefined custom property is not an error in CSS — it invalidates the whole declaration and the browser moves on, silently. `--space-5` had never been defined and seven screens used it, so they had no margin. And the billed-against-collected chart on `/reports` drew its bars in `var(--ink)` and `var(--accent)` when neither existed, so **both bars were transparent** — on a page whose figures Phase 7 verified in a browser. A table can be right while the chart beside it draws nothing, and reading the numbers is exactly what you do on a reports screen
  - [x] Verified against Neon in the browser: the caseload, the intake dialog and the reports screen render with legible labels, form controls that visibly are controls, and the two chart bars finally drawn
- [x] Accessibility audit: keyboard navigation, focus management, ARIA, contrast. Target WCAG 2.2 AA
  - [x] **Contrast was the previous slice**, measured from the stylesheet rather than sampled from a screenshot, and the six failures it found are fixed there. What is left here is everything a colour meter cannot see
  - [x] **A skip link, because every screen puts twenty navigation links in front of its content** (2.4.1). `tabIndex={-1}` on the target is the half that is usually missing: without it the browser moves the _scroll position_ and leaves focus on the link, so the next Tab goes straight back into the navigation and the link has achieved nothing. Off-screen rather than `display: none`, because the one thing it must be is in the tab order
  - [x] **The navigation drawer was a keyboard trap in all but name.** Every link inside it navigates, so tabbing off the end was the only way out and the scrim was mouse-only. Escape closes it (2.1.2), focus moves to the first item on open — otherwise the drawer is on screen and the keyboard is still in the masthead — and returns to the toggle on close (2.4.3), because focus left on a link that has just been hidden falls to the body and restarts Tab from the top of the page
  - [x] **The focus-return target is passed in, not found by class.** `document.querySelector(".nav-toggle")` works and ties one component to a class name in another, where nothing would notice the day it changed. The ref goes down from the shell to both halves
  - [x] The toggle gained `aria-expanded` and `aria-controls`. Without them the only way to learn whether the navigation is showing is to see it — the label said what the button does and never what state it is in
  - [x] `role="status"` on the two things that change without being asked to: the caseload as it swaps from reading to rows, and the optimistic status move. Both are obvious on screen and silent otherwise, which is the whole failure mode of an optimistic update
  - [x] **Twelve tables had an unnamed action column.** `<th />` is a header cell with no header in it, so the column is announced by position. Each now carries a visually-hidden name — and the reports table's bar column says what the bars restate, which is the two money columns beside them
  - [x] The masthead's bell measured **22×22** against the 24×24 of 2.5.8. It would have squeaked through on the spacing exception, since nothing is within 24px of it, but an exception is a let-off rather than a size to design to
  - [x] **Four class names were used and never defined**, which is the `var(--…)` failure in the other namespace and just as silent — an unknown class is not an error, the element simply has no rules. `.form-error` carried the **sign-in refusal** and three conflict-screen messages, so "that password is wrong" rendered as ordinary body text; `.btn-sm` left every row-level button full size; `.finding-list` fell back to browser bullets; `.topbar-search-form` did nothing, so the search box only looked right by accident of the input's own width. `tokens.test.ts` now fails on any of them
  - [x] **Fixing `.form-error` meant splitting it, not defining it.** Two of its four uses were real refusals and took `.form-refusal`; the third was the conflict screen's finding count, and framing that as an error would be the software reaching the decision the whole module exists to leave to an advocate. It has its own treatment and says so in the stylesheet
  - [x] 6 drawer tests, each mutation-verified — removing the Escape listener, the focus-into-drawer, or the guard that keeps a desktop page load from stealing focus fails exactly the test written for it. **`axe` is deliberately not here yet**: in jsdom it cannot check contrast, which is already checked better, and its real value needs a laid-out page. It belongs with Playwright below
  - [x] Verified in the browser: the skip link appears on focus and moves focus to `<main>` rather than only scrolling to it; the toggle's `aria-expanded` flips, focus enters the drawer and Escape closes it; a DOM audit found one `h1` per page, no skipped heading levels, no duplicate ids and no unnamed control; and the conflict screen's three findings render as findings
- [ ] Headless primitives only where hand-rolling a11y is genuinely hard — dialog, combobox, date picker. Everything else stays hand-written CSS
- [x] Responsive pass — the wireframe is desktop-first; fix mobile
  - [x] **The media queries had never been checked at a real width by anything but a person resizing a window**, which is why this waited for Playwright rather than being done by eye earlier in the phase. Two defects had accumulated behind that, and neither was subtle once a browser was pointed at 390px
  - [x] **The masthead was drawing over itself.** The brand, the name, the role, the badge and "Sign out" were all still laid out at their desktop sizes in 390px; the row ran past the viewport and `.shell`'s `overflow: hidden` clipped the far end. What is dropped now, and in this order: the tagline and the search first (decoration, and a whole screen away at `/search`), then the avatar (it is `aria-hidden` decoration — a picture of the name printed beside it), then the role. **The name stays**, truncating rather than disappearing, because it is the only thing on screen saying whose session this is and on a shared phone that is the first question
  - [x] **The money figures were clipped, and the cause is a CSS default worth knowing.** A grid item is `min-width: auto`, which refuses to shrink below its content — so "Ksh 795,000.00" at 30px did not wrap or shrink, it reached past its column. `min-width: 0` is the fix for the overflow and smaller type below 600px is the fix for it then being unreadable in the width it fits into; both are needed, which the mutation run shows — restoring `auto` alone still fails two screens
  - [x] **`document.scrollWidth` was already correct everywhere and said nothing.** `.content` has `overflow-y: auto`, which makes it a scroll container on _both_ axes, so anything too wide scrolled sideways inside the pane while the page reported itself as fitting. That is why the figures had been clipped for as long as they had — nothing measuring the page could see it. The assertion is about the pane
  - [x] **Two wrong measurements before the right one, which is the interesting part.** It looked like elements overlapping: flex items do not overlap. It looked like text spilling its box: `scrollWidth > clientWidth` found nothing, because the item it happens to is the brand — an inline `<a>`, and both properties are defined as _zero_ for an inline box, so the measurement returned an answer while measuring nothing. What is true is that every item's painted box has to finish inside the bar, and that assertion fails on the pre-fix masthead and passes on this one
  - [x] The test also found something real on its own: the notification badge is `position: absolute` at `right: -6px` because it is _meant_ to overhang the bell, and an out-of-flow child still counts toward its parent's `scrollWidth`. Stated as an exception rather than designed away
  - [x] **A wide table is not a defect and is not "fixed".** `.table-wrap` gives a nine-column table its own bounded scroll box, which is a considered answer on a 390px screen; because the box is bounded it does not make the pane scroll either. Turning every table into a stack of cards would be a different design, not a repair
  - [x] 12 specs at 390×844: nine screens fit without the pane scrolling, the masthead stays inside itself, and the drawer opens, reaches Billing and closes on Escape — the last being the single point of failure for the whole application at that width
  - [x] **Not covered: the client portal at phone width.** These specs run as the partner, and the portal needs a client session; its header wraps and its grid is already single-column below 900px, but that is an inspection rather than an assertion
- [x] Loading skeletons and empty states everywhere
  - [x] **One route of twenty-six had a loading state.** The cost of that is invisible in development and obvious in production: Next keeps the shell in place and swaps only the content pane, so without a boundary a link click does _nothing_ until the server answers — and against a Neon instance that has scaled to zero, that is the better part of two seconds with the previous page still on screen and the browser's own spinner as the only evidence anything happened
  - [x] **The page title is real, not a block.** A title is a fact known before any query runs and unchanged after it, so drawing a grey rectangle where it goes is pretending not to know something and then shifting the layout when the real one lands. It is not a prop either: every route is already named in `lib/nav.ts`, and `itemForPath` resolves a nested path to its section, so `/cases/{id}` answers "Cases" without being told. A title passed in would be the same string written twice, and the copy that goes stale is always the one nobody looks at
  - [x] `shape` _is_ duplicated knowledge, and that is stated rather than hidden: unlike the title there is no existing place that holds it. The trade is that a stale shape draws the wrong silhouette for a second, where a stale title would be a wrong claim about which screen you are on
  - [x] **A skeleton pulses, and it is the only animation in the application.** Static grey blocks render "still loading" and "loaded, and empty" identically, and only one of those is worth waiting through. Declared _inside_ `prefers-reduced-motion: no-preference` rather than switched off inside `reduce` — same result for the two settled cases, and a user agent that reports nothing gets the still version, which is the one that is safe to guess wrong about
  - [x] One `role="status"` for the whole wait and the blocks themselves `aria-hidden`. A screen reader has nothing to gain from eleven unlabelled rectangles
  - [x] **`cases/loading.tsx` was deleted rather than rewritten.** `/cases` waits for nothing — its rows are an atom and the table reports its own progress — so a loading state there was a file claiming to cover a wait that does not happen. Worse, a `loading.tsx` covers its whole subtree, so the one sitting there was really answering for the matter file under the wrong name. The matter file has its own now
  - [x] `routes.test.ts` asserts the rule in both directions: every page that imports the runtime has a boundary in its own directory or an ancestor, and no page that reads nothing has one. Two exemptions, each with its reason in the table — and a third test fails if an exemption goes stale, because an exemption nobody revisits is a comment. Mutation-verified in both directions
  - [x] **Empty states were already there**, which is worth recording as a finding rather than inventing work: every screen that maps a list already guards it, and the two that do not — the users page's role table and the precedent bank's stale section — cannot be empty and are conditionally rendered
  - [x] Verified in the browser by holding a server read open for six seconds: `/reports` draws its real title, the ruled figure row and the table beneath it, with the shell and the current nav item intact
- [x] Form validation UX driven by the same schemas as the server
  - [x] Every form already decoded its `FormData` through a schema on the server, and every one **also restated part of that schema by hand in JSX** — a `required` here, nothing at all there. Two descriptions of one rule with only one of them enforced, so the copy in the markup could quietly stop being true and the only symptom would be a round trip that did not need to happen. `constraintsOf` reads the schema instead, so a constraint added to the domain reaches the input in the same commit
  - [x] **`JSONSchema.make` describes the _encoded_ side**, which is the side a form submits — strings, in every case. That is what makes one helper work across the plain `Schema.Struct` forms and the `Schema.transform` ones, whose decoded type is a service argument no input could hold
  - [x] **The rule for what gets derived: a constraint is worth deriving when the browser's own message is no worse than the sentence the server would have sent.** `required` is strictly better — the browser says the whole of what the server would, without the round trip. `maxLength` produces no message at all; it stops the typing. Numeric bounds are **not** derived, because `claimValueShillings` is a `NumberFromString` and its "non-negative" refinement sits on the decoded side, so the encoded schema has no `minimum` to read — deriving one would mean assuming the transform is monotonic
  - [x] **The clever idea was tried and rejected on inspection.** A `title` beside a `pattern` is appended to the browser's "Please match the requested format", so the schema's own description could have become the browser's explanation. Then the candidates were read: _"a Universally Unique Identifier"_ and _"a non empty string"_ say what the value **is** rather than what to type, and appending either makes the message worse. The one description that _is_ an instruction — the KRA PIN's — is already on that field as a hint and a placeholder, permanently, which beats a bubble that appears once and only on a mistake. A pattern whose only description restates the regex is dropped entirely
  - [x] **What the pattern earns without a message is real**: `NonEmptyTrimmedString` refuses a field containing only spaces, which `required` alone happily submits. Verified in the browser — a title of three spaces is now `patternMismatch` before anything is sent
  - [x] A `<select>` drops what HTML defines only for text inputs, rather than every caller having to remember which of its fields are dropdowns: `constraintsOf` answers for a **field**, and the schema knows a matter id is a UUID without knowing whether it is typed or chosen
  - [x] **The client intake form is the one place a `Schema.Union` reaches the markup**, and it is the nicest result: which set of constraints applies is chosen by the segmented control, so `contactName` is required in the corporate half and absent from the individual one, and neither fact is written down in the component
  - [x] `Credentials` moved out of the sign-in action into its own `forms.ts` — a `"use server"` module may export nothing but async functions, and this is the last module to gain the `forms.ts` every other one had
  - [x] Four hand-written `required`s survive and each carries its reason in the code: two file inputs, whose bytes are not a schema field at all; the portal composer, whose action reads one string inline rather than through a schema; and the conflict screen, which never reaches a Server Action. A test fails on any _other_ bare `required` in a form that derives the rest — **a form with a mix of derived and hand-written rules is worse than one with neither, because the hand-written half now looks maintained**. Mutation-verified
  - [x] 7 tests on the derivation and the drift guard. Verified against Neon in the browser: the intake dialog's five required fields and eight optional ones match `OpenMatterForm` exactly, patterns appear on the two text fields and on neither the selects nor the dates, and a whitespace-only title is refused before submission
- [ ] Lighthouse ≥ 95 across the board; Core Web Vitals green
- [x] Playwright E2E covering the critical paths: login, create case, log time, invoice, pay
  - [x] **One test for the whole path, not four.** Each step needs what the one before produced — you cannot bill hours you have not recorded — so splitting them would mean four tests that each rebuild the state, or four that depend on execution order, which is one test pretending to be four. They are `test.step`s, so a failure still names which one broke
  - [x] **Against the seeded Neon, not a throwaway.** A hermetic Postgres per run would have been the safer choice; what this proves instead is that the _deployed configuration_ works — the shared pool, the real migrations, the demo data a reader will actually see. The cost is that a run writes to that data, and it is paid by `sweep.ts`: every record a run creates begins with `E2E`, and the sweep runs **before** the suite as well as after, because an `afterEach` cannot clean up after a process that crashed and a crashed run's debris is exactly what the next run trips over
  - [x] **The marker is in the title, where a person can see it**, not in a hidden column. A marker only the tests know about stops matching the day somebody changes how a record is written — and it fails _silently_, by sweeping nothing
  - [x] **The audit trail is deliberately left behind.** `audit_log` refuses `DELETE` outright, so a run leaves `case.opened`, `time.recorded`, `invoice.raised` and `payment.recorded` entries against the demo account. That is Phase 6's guarantee working: a suite that could erase its own trail would be a worse thing than untidy demo data
  - [x] **One worker, deliberately.** Two would race on the derived matter reference — which the service _handles_, by retrying onto the next free number, so the race would not fail; it would make the reference a spec asserts on unpredictable. Parallelism would buy a minute and cost determinism
  - [x] A production build rather than `next dev`: the dev server recompiles on first hit, holds a hot-reload socket open and paints an error overlay over the page — three sources of timing noise in a suite whose value is being trustworthy about timing
  - [x] **`axe` landed here rather than in the unit suite**, as recorded above. In jsdom it cannot check contrast — which `tokens.test.ts` checks better, from the stylesheet, in both themes — and the rest needs geometry. Six screens × two themes, and **mutation-verified**: weakening `--ink-muted` back to the failing ramp step produces 6 to 18 contrast violations per screen, so the pass is the token work holding rather than axe finding nothing
  - [x] **A real defect found by running it: a browser that navigates away was being logged as an unhandled failure.** Next prefetches the next route as a stream and cancels it the moment somebody clicks, so `onRequestError` sees an abandoned write constantly during ordinary use — and Phase 8 reported every one at `Error`. That is a steady drip into the one view that exists to hold real faults, and the failure mode of noise is not that it is annoying, it is that it teaches people to skim. `clientWentAway` demotes it to `Debug`, applying the same judgement `reported` already makes about typed failures: nothing failed, the only party who wanted the request abandoned it. 9 tests, including that a database that stopped answering is **not** demoted for mentioning a connection
  - [x] The CI job is written and **off**, with the reason in the file rather than in a commit message: these specs write, and pointing them at the deployment's own database from an unattended push would put a run's debris in front of whoever opened the demo. Turning it on is a Neon branch and a secret — which is what preview environments should have anyway (Phase 2 records the shared database as deliberate and per-preview branches as the obvious upgrade)
  - [x] 17 specs green against Neon: the front door including a refusal and a sign-out, then a matter opened as `OKL-2026-041`, two and a half hours recorded against it at the partner's rate, 50,000 of work in progress turned into a fee note — the matter leaving the work-in-progress list as its entries are claimed — and the fee note paid in full and deriving `Paid` without anything having set a field
- [x] Dark mode — shipped, with a three-state control
  - [x] **Both themes are declared in one place, once per token.** `light-dark()` resolves against the _used_ `color-scheme`, so `--ink: light-dark(neutral-950, neutral-100)` is the whole of it: no `prefers-color-scheme` media query, no second `[data-theme]` block, and therefore no second copy of the palette to drift. The only theme-aware declaration in the stylesheet is `color-scheme` itself — which the user agent reads too, and is what keeps the native date picker, the select popup and the scrollbars in step with the page instead of a white panel opening over a dark one
  - [x] **Dark mode is what showed the token layer was half done.** The primitives/roles rule had been enforceable for `color:` and not for `background:`, because three grounds and all three tags were naming ramp steps as fills and there was no principled reason to stop them. Two palettes settled it: a ramp step's value is fixed, so a tag that must be dark-on-light in one theme and light-on-dark in the other **cannot** be written that way. `--color-inset`, `--fill-highlight`, `--fill-inert`, `--line-soft` and six `--tag-*` roles exist because of it, and `tokens.test.ts` now holds fills and edges to the same rule — the documented tag exception is gone rather than grandfathered
  - [x] **`--ink-inverse` needs no dark value, and the reason is the nicest result here**: the page ground is the right label colour on a saturated fill in _both_ themes, because the fill moves to the other end of its ramp when the ground does. Dark ink on light teal, light ink on dark teal, one declaration. **`--line-control` needs no dark value either** — the middle of a ramp is the one place that clears 3:1 against both ends of it, so `neutral-600` measures 3.6:1 on the light input fill and 3.6:1 on the dark one. That is the same fact as "there is no fifth ink role", read from the other side
  - [x] **The ink-tinted washes carried over for free**, which is the payoff for having defined them against `--ink` rather than a literal: a hover that was 7% ink over paper becomes 7% paper over ink with nothing added. The scrim is the exception and got a real dark value — it is not a tint of the foreground but the page being pushed back, and on a dark page 50% of a dark grey pushes nothing. Shadows likewise: an ink tint on a dark ground is invisible
  - [x] **Every figure re-measured, not assumed.** `tokens.test.ts` resolves `light-dark()` itself and runs every assertion against both palettes — 39 tests where there were 20. Mutation-verified in both halves: painting a ramp step straight onto an element fails the new fills rule, and moving dark `--ink-muted` one step to `neutral-600` fails at 3.6:1 exactly as the light one does
  - [x] **The third state is "follow the machine", and it is the default** — an absent attribute rather than a stored word, which is what leaves `color-scheme: light dark` free to resolve against the media query. Making it an explicit option is what lets somebody go back to it after picking a side
  - [x] **The no-flash script has to be inline and synchronous**, and its cost is stated rather than hidden. Every other way of applying a stored choice runs _after_ the first paint, so somebody who chose dark gets a white page for a frame on every load. The cost is one `suppressHydrationWarning` on `<html>`: the server cannot know a value that only exists in the browser, so React finds an attribute it did not render — **found in the browser as a real hydration error before it was fixed**, not anticipated
  - [x] The control is in the **sidebar**, not the masthead: the masthead is the identity cluster and already drops the search below 900px, while the sidebar is present at every width — a column on a desktop, the drawer on a phone. One instance, so there is no second copy to keep in step. It waits for the store before touching the attribute, because acting on the atom's server value would clear what the script had just set and reintroduce the flash it exists to prevent
  - [x] Verified against Neon in the browser: the system preference resolves with no attribute at all, choosing Light and Dark flips `color-scheme`, the ground and the ink together, the choice survives a reload through the inline script, and a dialog over a table reads correctly in dark with its scrim, its shadow and its native date pickers

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

| Date       | Decision                                      | Reasoning                                                                                                                                                                                                                                   |
| ---------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-18 | Effect 3.22.x, not 4.0-rc                     | `@effect-rx/rx-react` peer-deps on `effect@^3.17` with no v4 track; choosing v4 today would cost the client-side Effect layer                                                                                                               |
| 2026-08-18 | Effect end to end, including React            | Deliberate: the client-side story is the differentiator vs. typical Effect backends                                                                                                                                                         |
| 2026-08-18 | Neon Postgres + Vercel                        | Free at portfolio scale, clean `@effect/sql-pg` fit, one-click live demo                                                                                                                                                                    |
| 2026-08-18 | D-1 Single firm                               | Multi-tenancy is plumbing, not signal; a stated scope boundary reads as judgment                                                                                                                                                            |
| 2026-08-18 | D-2 Better Auth, self-hosted                  | Own the interesting parts (sessions, roles, audit) without hand-rolling crypto                                                                                                                                                              |
| 2026-08-18 | D-3 Deep Kenyan domain                        | Researched jurisdictional detail is the cheapest way to look senior                                                                                                                                                                         |
| 2026-08-18 | D-4 Vercel Blob, private                      | Private-by-default matters for legal documents; no infra overhead                                                                                                                                                                           |
| 2026-08-18 | D-5 Seeded accounts + role switcher           | Zero friction to a full dashboard; doubles as an RBAC showcase                                                                                                                                                                              |
| 2026-08-18 | D-6 Keep hand-written CSS                     | Distinctive beats default shadcn; rewriting working CSS buys nothing                                                                                                                                                                        |
| 2026-08-18 | D-7 Testcontainers                            | Hermetic and identical locally and in CI; no quota, no CI secrets                                                                                                                                                                           |
| 2026-08-19 | Docker verification → Phase 12                | Installing Docker blocks nothing early; deferring keeps Phase 0 shippable. Pull forward if Phase 2 needs the feedback loop                                                                                                                  |
| 2026-08-19 | D-9 Trunk-based, `main` only                  | PR review is self-review on a solo project; pre-push hook and `verify:clean` replace the lost CI gate                                                                                                                                       |
| 2026-08-18 | D-8 Public repo from day one                  | Forces commit hygiene now; the wireframe → system progression is the story                                                                                                                                                                  |
| 2026-08-19 | Row↔domain mapping as a schema                | A `transformOrFail` has an encode side, so reads and writes cannot drift apart the way two hand-written functions do                                                                                                                        |
| 2026-08-19 | Ordering columns for domain lists             | `contacts[0]` and an invoice's line order carry meaning; a `SELECT` with no `ORDER BY` has no first element                                                                                                                                 |
| 2026-08-19 | `sslmode` pinned in code, not env             | Vercel owns `DATABASE_URL` and `vercel env pull` overwrites hand-edits; one line covers every environment                                                                                                                                   |
| 2026-08-19 | In-memory repositories, not mocks             | A second implementation of an interface that already existed. No framework, no stubbed method names to keep in sync — and the fakes enforce what the schema enforces                                                                        |
| 2026-08-19 | Certificate checked on filing only            | The domain holds the _current_ certificate and no history, so re-checking on every edit would block historic files over a year the system cannot speak to                                                                                   |
| 2026-08-19 | Reference race left to the index              | A database sequence would remove the race and hand out gaps on every rollback; a client-visible reference is the wrong place for gaps. `UNIQUE` + retry instead                                                                             |
| 2026-08-19 | Courts chosen whole, not assembled            | Four free inputs can build a `MagistratesCourt` with no rank; a keyed list cannot, and a firm files in a known set of stations anyway                                                                                                       |
| 2026-08-19 | Wire schemas separate from domain             | `DateFromSelf` encodes to a `Date`, which JSON cannot carry. Derived from the domain's own `fields`, so only the dates are restated, and guarded twice so neither half can drift                                                            |
| 2026-08-19 | No `documents` endpoint group                 | No repository, no mapping, nothing seeded. A generated client is only worth having if the contract is true; an endpoint over an empty table to tick a box spends exactly that                                                               |
| 2026-08-19 | Errors are the domain's own classes           | Re-declaring them in `api/` would hand the client a different class with the same name. Sharing them means `reason` is reconstituted on the client rather than transmitted                                                                  |
| 2026-08-19 | API shares the runtime's `memoMap`            | Otherwise `toWebHandler` builds `PgLive` a second time: two pools in one process, each sized for the whole process, against a database with a connection limit                                                                              |
| 2026-08-19 | `RepositoryFailure` dies, not fails           | It carries the driver's message, which can carry the query. A defect gets an empty 500 — there is no body, so there is no encoder to be talked into including the detail                                                                    |
| 2026-08-19 | Rx over TanStack Query + Zustand              | The atom runs an `Effect`, so a refusal arrives as the class the service failed with rather than as whatever a `fetch` wrapper threw. One dependency the stack already carried                                                              |
| 2026-08-19 | `rx/session.ts` reimplements `Rx.kvs`         | The library collapses the read into `getOrElse(default)`, so "nothing stored" and "not read yet" are one value. A screen that waits on hydration needs to tell them apart                                                                   |
| 2026-08-19 | Every browser atom declares a server value    | Next renders client components on the server first. Without it a `localStorage` read runs there and the first client render disagrees with the HTML                                                                                         |
| 2026-08-19 | Caseload client-fetched, matter file not      | Filtering is interaction and belongs to the browser; a file is a document you land on and link to, and stays a Server Component read with no HTTP hop                                                                                       |
| 2026-08-20 | Authorization as a requirement in the type    | `CurrentUser` in the `R` channel means an unauthorized read does not compile. A `getSession()` returning `User \| null` is advisory, and nothing marks the call sites that ignored it                                                       |
| 2026-08-20 | Out-of-scope reads answer `NotFound`          | "You may not see this matter" confirms the matter, the client, and that the firm acts for them. Staff still get a 403 with the reason: scope conceals, permission explains                                                                  |
| 2026-08-20 | Permission and scope are separate checks      | A portal user genuinely holds `case:read` — the scope is what protects the other clients. Conflating them yields either a portal that reads nothing or a check that passes over an unscoped query                                           |
| 2026-08-20 | Audit entry inside the mutation's transaction | A trail written afterwards leaves a change nobody made, on the one occasion something failed. `Transactor` is an interface so the guarantee is testable without a database                                                                  |
| 2026-08-20 | Auth tables in our migrations, not the CLI    | `users` carries the staff/client link the whole phase rests on. Hand-written and then checked against `getSchema`, so a library upgrade fails a test rather than the first sign-in                                                          |
| 2026-08-20 | One pool shared with Better Auth              | A connection string would have opened a second pool against a database with a connection limit — the Phase 4 `memoMap` problem in a new place                                                                                               |
| 2026-08-20 | Sign-in as a Server Action, not a fetch       | The form works without JavaScript, the refusal is the same `ActionState` every other form uses, and there is one door — so the audit entry cannot be gone around                                                                            |
| 2026-08-20 | `roleRx` deleted                              | A role the browser can set is not a role. The principal is resolved on the server from a signed cookie and passed down; two answers to "who is this" is one too many                                                                        |
| 2026-08-19 | `overrides` to dedupe `@effect/platform`      | `@effect-rx/rx` peer-depends on ^0.90 and npm nested a second copy. The `KeyValueStore` module is identical between them; two copies in one browser bundle is not                                                                           |
| 2026-08-21 | Effect's tracer from the **global** provider  | `NodeSdk.layer` would build a second one, so Next's request span and Effect's service spans would be two parallel traces. Neither answers where the time went                                                                               |
| 2026-08-21 | The correlation id **is** the trace id        | A threaded request id reaches the code somebody was debugging that week and nowhere else. The logger reads the current span from the fiber, so it survives a fork and costs no parameter                                                    |
| 2026-08-21 | Retry classified by what the attempt **did**  | Not by "is this transient". A dropped connection may have committed the write; reads replay on it and writes do not, which is the difference between a round trip and a payment posted twice                                                |
| 2026-08-21 | Timeouts per attempt, not per operation       | Three attempts sharing one budget is a policy that stops retrying under load — exactly when it is needed                                                                                                                                    |
| 2026-08-21 | No rate-limit counter keyed on an account     | Every advocate's address is public, so a per-account limit is a remote control for locking partners out. Every bucket includes the source; a botnet defeats that, and a second factor is what would not                                     |
| 2026-08-21 | Rate-limit buckets stored as a hash           | Unhashed, the table is a log of who tried to sign in and from where, beside the matters they are privileged to see. The audit trail already holds that, with retention discipline                                                           |
| 2026-08-21 | D-10 Error tracking without Sentry            | An exception already reaches the traces backend on the span it failed, and `onRequestError` writes the digest and route to the drain. A DSN-less second SDK with a build wrapper would be a claim the app does not honour                   |
| 2026-08-22 | `light-dark()` rather than two palette blocks | The usual arrangement writes the whole palette twice — once in a media query, once under `[data-theme]` — and that is where the copies drift. One declaration per token, and `color-scheme` chooses                                         |
| 2026-08-22 | Theme applied by an inline script             | Anything running after the first paint shows a white frame to somebody who chose dark. The cost is one `suppressHydrationWarning`: the server cannot know a value that only exists in the browser                                           |
| 2026-08-22 | Input constraints derived, not restated       | A form decoded its `FormData` through a schema _and_ hand-wrote part of the same rule in JSX. Only one of the two was enforced, so the other could stop being true with no symptom but a wasted round trip                                  |
| 2026-08-22 | Derive a constraint only if its message holds | The browser's own wording has to be no worse than the sentence the server would send. `required` and `maxLength` qualify; a `pattern`'s "match the requested format" does not, so it is carried without a title rather than explained badly |
| 2026-08-22 | A skeleton derives its title from the nav     | The title is a fact known before the query and unchanged after it. Passing it as a prop writes the same string twice, and the copy that goes stale is the one nobody looks at                                                               |
| 2026-08-22 | The drawer's return-focus target is a prop    | Finding it with `querySelector(".nav-toggle")` ties one component to a class name in another, where nothing notices the day it changes. The shell owns the ref and hands it to both halves                                                  |
| 2026-08-22 | `axe` waits for Playwright                    | In jsdom it cannot check contrast — which `tokens.test.ts` already checks from the real stylesheet — and the rest of what it finds needs a laid-out page to find it on                                                                      |
| 2026-08-22 | Design tokens split into primitives + roles   | A primitive is a value; a role is a job with a contrast bar attached. Without the split there was no answer to "may I use this here", and twenty-four ad-hoc `color-mix` expressions had accumulated at ten ink strengths                   |
| 2026-08-22 | Ink roles are opaque, washes are not          | A transparent ink is a different colour on every ground, so it has one contrast answer per ground and nobody re-measures. A wash has to work over a row, a card and a button at once, and is never text                                     |
| 2026-08-21 | Health probe budget matches a query's         | Measured: Neon answers cold in 1,657ms. A two-second probe reports `degraded` for a deployment that would have served the page, and somebody gets paged for it                                                                              |

---

## 9. Progress log

One line per session. Keeps momentum visible across a long project.

| Date       | Phase | What moved                                                                                                                                                                                                                                        |
| ---------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-18 | —     | Wireframe committed; roadmap written; all eight architectural decisions settled                                                                                                                                                                   |
| 2026-08-19 | 2     | Row↔domain mapping, case/client/invoice repositories, the trust settlement transaction, migrations 0002–0003. 263 unit tests, 34 integration                                                                                                      |
| 2026-08-19 | 2     | Seed script: the wireframe's fixtures decoded into Postgres through the domain schemas, idempotent on derived ids. 309 unit tests, 39 integration                                                                                                 |
| 2026-08-19 | 2     | Closed the two gaps the seed surfaced: `KenyanPhone` widened to fixed lines (migration 0004), intake dates supplied per matter. 336 unit tests                                                                                                    |
| 2026-08-19 | 3     | `CaseService`, the runtime, and the Cases slice end to end: Server Components read Neon, Server Actions decode through Schema, refusals render as sentences. 385 unit tests                                                                       |
| 2026-08-19 | 4     | Typed HTTP API: one contract, from which the router, the client and the OpenAPI document are all derived. Cases, clients and billing; documents deferred to Phase 7. 415 unit tests                                                               |
| 2026-08-19 | 5     | Effect on the client: `AppState.tsx` retired into atoms, the caseload and intake choices read through the generated client, an optimistic status move that rolls back. 433 unit tests                                                             |
| 2026-08-20 | 6     | Identity, authorization and audit: `CurrentUser` in every service's type, permissions as data, portal isolation proven adversarially, every mutation audited in its own transaction. 517 unit tests                                               |
| 2026-08-20 | 7     | Billing, time, clients and the court diary through the stack; documents into a private Blob store with signed URLs. 723 unit tests                                                                                                                |
| 2026-08-21 | 7     | Tasks, the client portal on real data, five lighter slices, reports with aggregation in SQL and a CSV export, and global search. 888 unit tests, 49 integration                                                                                   |
| 2026-08-21 | 7     | Appointments, with the clash check that reads the court diary; the dashboard composed from the services behind each figure. **No `lib/data` import remains in `src/app/`.** 942 unit tests                                                        |
| 2026-08-21 | 8     | Observability and resilience: Effect's spans nested under Next's, the trace id as the correlation id, retry classified by what the previous attempt did, budgets on every external call, a durable auth throttle, `/api/health`. 1,000 unit tests |
