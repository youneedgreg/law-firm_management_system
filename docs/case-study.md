# OKLaw: case study

A practice management system for a Kenyan law firm: matters, court diary, trust
accounting, billing, documents and a client portal.
[Live demo](https://law-firmmanagementsystem.vercel.app/sign-in). The data in
the demo is fictional, and nothing in this document describes a real firm,
client or matter.

The hardest single problem has its own write-up:
[one rule about client money, in four places](case-study-trust-accounting.md).

## Problem

Small and mid-sized firms in Nairobi run on spreadsheets, WhatsApp and paper
diaries. Three failures are specific and expensive:

- **A missed court date** can mean a matter dismissed for want of prosecution.
- **Client money held in trust** is governed by the Advocates (Accounts) Rules,
  and commingling it with firm money is a disciplinary matter.
- **Conflicts of interest** must be checked before a matter is opened, against
  every client the firm has acted for or against.

These rules have hard edges, so the aim was to encode them so that breaking one
fails to compile or fails loudly at a boundary, rather than producing a quietly
wrong number.

## Role

Sole developer. The roadmap records this as a solo project (D-9), and every
commit in the repository is by the same author.

> **TODO(greg):** add how long this took, and any contact with practising
> advocates that shaped the domain model. Neither is recorded in the repository.

## Approach

- **Effect end to end.** Fallible operations list their errors in the type
  signature, dependencies are injected as Layers rather than mocked, and tests
  use virtual time ([ADR 0002](adr/0002-effect-as-the-application-runtime.md)).
- **Layering the linter enforces.** Dependencies point inward, and
  `eslint.boundaries.mjs` makes a service that reaches into `infra/` fail CI.
- **A domain modelled from statute.** A court is a typed union rather than a
  string, money is integer minor units, and statutory claims are cited in
  [`domain-notes.md`](domain-notes.md) with confidence markers.
- **One rule, several placements.** Rule 10 lives in a domain function, a
  database trigger, a repository translation and a transaction ordering, because
  each answers a different question.
- **Documents that fail the build.** The ERD is generated from the migrations,
  and a test checks the architecture diagram against the linter's boundary table
  ([ADR 0014](adr/0014-documentation-that-fails-the-build.md)).

The stack is Next.js 16, React 19, Effect 3.22, Postgres on Neon, self-hosted
Better Auth and private Vercel Blob storage.

## One decision

From [ADR 0013: one-click demo access](adr/0013-one-click-demo-access.md).

**Context.** A reviewer should see the system in the first few seconds. Open
sign-up lands them on an empty dashboard, and one read-only guest account hides
the role model. A one-click switcher solves both, but a button that signs
somebody in is an unauthenticated endpoint that mints sessions.

**Options.**

1. Carry the address and password in hidden form fields.
2. Add a demo mode that skips the password check.
3. Have the button post a key that resolves to a seeded account, then run the
   normal sign-in.

**Choice.** Option 3. The set of accounts is a closed list in the source, and an
unknown key is refused. The password is checked by the same gateway, the attempt
is audited by the same code, and the session is issued the same way, so there is
no second way in. A separate rate-limit counter that success does not clear
covers the fact that every press succeeds.

A later amendment made the feature conditional on `DEMO_DEPLOYMENT`, which
defaults to off. An unset or misspelt variable therefore means a real
installation with the switcher absent.

**Trade-off.** The demo password is published on the sign-in page, which is
acceptable only because the accounts are fixtures for a firm that does not
exist. The nightly reset signs out anyone using the demo at midnight UTC. The
ADR also records that preview and production share the demo database, so the
reset affects both.

## Verification

Run on 2 November 2026 at commit `db8b09b`, from a fresh clone.

| Suite       | Command                    | Result         |
| ----------- | -------------------------- | -------------- |
| Unit        | `npm test`                 | 1,147 of 1,147 |
| Integration | `npm run test:integration` | 49 of 49       |
| End-to-end  | `npm run test:e2e`         | 29 of 29       |

The repository also has 14 ADRs. The 29 end-to-end tests include one sign-in
setup step, so 28 are specs in their own right.

The integration and end-to-end suites write to whatever `DATABASE_URL` names, so
this run used neither the demo database nor real file storage:

- Postgres 17 on localhost with a temporary data directory and TLS, because the
  application requires `sslmode=verify-full`.
- A local stub in place of the Vercel Blob API, set through
  `VERCEL_BLOB_API_URL`. Stored files were therefore not exercised.
- Chromium through Playwright, against a production build.

**Not verified by this run:** behaviour on Neon, real Blob storage, the coverage
thresholds, typecheck, lint and build.

## Run it

Requires Node 24+ and npm. `DATABASE_URL`, `BETTER_AUTH_SECRET` and
`BLOB_READ_WRITE_TOKEN` are required, and `db:seed` also needs
`DEMO_DEPLOYMENT=true`.

```bash
npm install
npm run db:migrate   # against DATABASE_URL
npm run db:seed      # wipes the tables it owns, then loads the demo firm
npm run dev          # http://localhost:3000
npm test             # no database needed
```

`npm run test:integration` and `npm run test:e2e` write to `DATABASE_URL`, and
the integration suite runs the real seed. Point them at a throwaway database,
and do not run them with a Blob token for a store you care about.

The code is source-available, not open source: see
[`LICENSE.md`](../LICENSE.md).

## Limits

- **Integration and end-to-end tests are off in CI.** Both jobs are `if: false`,
  so CI runs the lockfile and formatting checks, typecheck, lint, unit tests and
  build, but not these two suites.
- **ADR 0006 no longer matches the code.** It and the comment in
  `vitest.integration.config.ts` describe Testcontainers, but the integration
  tests use `DATABASE_URL` directly.
- **No firm's installation has been deployed from this repository,** according
  to the README and roadmap. The separation is written and tested, but the checks
  that need a real second deployment are still outstanding.
- **No second factor on sign-in.** The README names this as absent.
- **Single-firm by design.** A second firm is a second deployment with its own
  database, not a tenant column ([ADR 0003](adr/0003-single-firm-scope.md)).
- **Still open:** hand-rolled dialog and date-picker primitives, and an Effect 4
  migration deferred until `@effect-rx` supports it.
