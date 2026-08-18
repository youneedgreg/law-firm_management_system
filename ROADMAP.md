# OKLaw — Engineering Roadmap

> A law-firm management system built as a portfolio-grade demonstration of
> production TypeScript: Effect end to end, Postgres, full test coverage, CI/CD,
> and documented architectural reasoning.

**Target:** portfolio-ready in 6–12 weeks · **Status:** Phase 0

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
- [ ] Remaining entities: `Client`, `Advocate`, `Hearing`, `Document`, `TimeEntry`
- [x] Dates are `Date` throughout the new schemas, never strings; every date-dependent function takes `asAt` as a parameter rather than reading the clock
- [x] Case status as a **state machine**: `TRANSITIONS` declares the legal moves once, `transition` returns `Either`, and self-transitions are refused rather than treated as no-ops. Tests assert every status stays reachable from `New`, so the table and the union cannot drift apart
- [x] Tagged errors carrying their own explanation: `InvalidTransition`, `TrustAccountUnderfunded`, `OutsideCourtJurisdiction`, `CannotFileWithoutValue`, `PaymentExceedsBalance`, `NotAWithdrawal`, `FractionalCents`. Each exposes a `reason` citing the rule, so a refusal explains itself instead of surfacing as a bare failure. (`ConflictOfInterest` deliberately does not exist — see the screening item below)
- [x] **Trust-account invariants** per the Advocates (Accounts) Rules: Rule 10 enforced per-client rather than per-account, balance derived from movements rather than stored, withdrawal reasons limited to Rule 9's purposes, amounts always positive with direction from the reason. Mutation-tested — swapping the per-client check for the firm total fails exactly the two tests written for it
- [x] Limitation periods from the verified s. 4 figures — contract 6y, tort 3y, defamation 12mo — each result carrying its provision so the UI cites the reasoning. Month arithmetic clamps rather than overflowing (29 Feb + 3y lands on 28 Feb). Court holidays and vacation still outstanding, pending the §3.2 research
- [x] Conflict-of-interest screening on intake — returns findings with the matter and concern, never a boolean. An empty result carries `mattersSearched`, so "nothing matched in these records" cannot be read as "no conflict exists"
- [x] Exhaustive rather than sampled property tests where the space is small enough to enumerate: `allocate` over 1,400 amount/part combinations, the trust invariant over 40 interleaved withdrawals, every status pair through the transition table. Two mutation tests confirm the suite fails when the rule is broken
- [ ] **Moved to Phase 2.** Decoding `src/lib/data/*.ts` through the schemas cannot happen here: the seed fixtures key on small integers and the domain keys on UUIDs, so the migration is the seed script's job, where real ids are minted. Attempting it now would mean writing a legacy-id adapter that Phase 2 immediately deletes

**Done when:** `src/domain/` has no imports from the rest of the project, and
tests cover every business rule.
**Demonstrates:** domain modelling, making illegal states unrepresentable,
errors as typed values.

---

### Phase 2 — Persistence · 3–4 weeks

- [ ] Provision Neon via Vercel Marketplace; `DATABASE_URL` in all three environments
- [ ] `PgClient` layer + `ManagedRuntime` in `src/runtime/`
- [ ] Schema design: tables, FKs, indexes, constraints. Push invariants into the DB (`CHECK`, `NOT NULL`, unique) — do not rely on application code alone
- [ ] Migration setup with `@effect/sql` migrator, committed and ordered
- [ ] `@effect/sql` `Model` classes bridging DB rows ↔ domain schemas
- [ ] Repository interfaces in `services/`, Postgres implementations in `infra/sql/`
- [ ] Transaction support, with one real multi-statement use case (invoice payment → trust ledger entry)
- [ ] Seed script importing the existing mock data into a real database, **decoding every fixture through the domain schemas** and minting UUIDs for the integer-keyed records (carried over from Phase 1). Invalid seed data must fail the script loudly rather than reaching the database
- [ ] Run `Ledger.overdrawnClients` after the import — a seeded trust ledger that breaches Rule 10 should stop the migration
- [ ] Integration tests against a real Postgres via Testcontainers (D-7), running in CI — written here, but only executable once Phase 12 installs Docker

**Done when:** the seed data lives in Postgres and repository tests pass against
a real database in CI.
**Demonstrates:** you treat the database as part of the design, not a dumb store.

---

### Phase 3 — Services and the first vertical slice · 3–4 weeks

Take **Cases** all the way through the new stack while every other module still
runs on mock data. Prove the architecture on one slice before committing to it
across twenty.

- [ ] `CaseService` as an `Effect.Service` with a Layer
- [ ] Wire `/cases` and `/cases/[id]` to real data via Server Components
- [ ] Create and edit cases through Server Actions with `Schema` validation at the boundary
- [ ] Error handling: typed failures mapped to UI states, `error.tsx` boundaries
- [ ] Optimistic UI on status transitions
- [ ] Service-level tests with in-memory repository Layers (no DB needed)

**Done when:** cases are fully real — read, create, edit, transition — and the
test suite covers the service with mock Layers.
**Demonstrates:** dependency injection that pays off, testability without mocking
frameworks.

---

### Phase 4 — Typed HTTP API · 2–3 weeks

- [ ] `HttpApi` definition in `src/api/` — the shared contract
- [ ] Endpoint groups: cases, clients, billing, documents
- [ ] Server implementation mounted at a Next route handler
- [ ] `HttpApiClient` derived from the same definition — no hand-written fetch calls, no duplicated types
- [ ] OpenAPI spec generated from the definition, served at `/api/docs`
- [ ] API-level integration tests

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
- [ ] **Documents** — real uploads to private Vercel Blob (D-4), signed URLs, versioning, categories, access control
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

| Date       | Decision                            | Reasoning                                                                                                                     |
| ---------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-18 | Effect 3.22.x, not 4.0-rc           | `@effect-rx/rx-react` peer-deps on `effect@^3.17` with no v4 track; choosing v4 today would cost the client-side Effect layer |
| 2026-08-18 | Effect end to end, including React  | Deliberate: the client-side story is the differentiator vs. typical Effect backends                                           |
| 2026-08-18 | Neon Postgres + Vercel              | Free at portfolio scale, clean `@effect/sql-pg` fit, one-click live demo                                                      |
| 2026-08-18 | D-1 Single firm                     | Multi-tenancy is plumbing, not signal; a stated scope boundary reads as judgment                                              |
| 2026-08-18 | D-2 Better Auth, self-hosted        | Own the interesting parts (sessions, roles, audit) without hand-rolling crypto                                                |
| 2026-08-18 | D-3 Deep Kenyan domain              | Researched jurisdictional detail is the cheapest way to look senior                                                           |
| 2026-08-18 | D-4 Vercel Blob, private            | Private-by-default matters for legal documents; no infra overhead                                                             |
| 2026-08-18 | D-5 Seeded accounts + role switcher | Zero friction to a full dashboard; doubles as an RBAC showcase                                                                |
| 2026-08-18 | D-6 Keep hand-written CSS           | Distinctive beats default shadcn; rewriting working CSS buys nothing                                                          |
| 2026-08-18 | D-7 Testcontainers                  | Hermetic and identical locally and in CI; no quota, no CI secrets                                                             |
| 2026-08-19 | Docker verification → Phase 12      | Installing Docker blocks nothing early; deferring keeps Phase 0 shippable. Pull forward if Phase 2 needs the feedback loop    |
| 2026-08-19 | D-9 Trunk-based, `main` only        | PR review is self-review on a solo project; pre-push hook and `verify:clean` replace the lost CI gate                         |
| 2026-08-18 | D-8 Public repo from day one        | Forces commit hygiene now; the wireframe → system progression is the story                                                    |

---

## 9. Progress log

One line per session. Keeps momentum visible across a long project.

| Date       | Phase | What moved                                                                      |
| ---------- | ----- | ------------------------------------------------------------------------------- |
| 2026-08-18 | —     | Wireframe committed; roadmap written; all eight architectural decisions settled |
