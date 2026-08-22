# From demo to first client

> How this repository becomes two running systems — the public portfolio demo
> and one law firm's live installation — without becoming two codebases.

The phases are ordered by dependency and by blast radius:
Phase A removes the things that would be a breach in a client
deployment, Phase B separates your product's identity from your customer's, and
only then does Phase C put a real firm's data anywhere. Check the boxes as you
go; the diff is the progress log.

`npm run verify` must pass at the end of every phase. Never leave `main` broken.

---

## 0. The decision this plan implements

**One repository, two deployments, two databases, no multi-tenancy.**

There is no tenancy in this system and this plan does not add any. Every one of
the 23 tables answers questions about _the_ firm, singular — there is no
`firm_id` anywhere in `src/`, and that was the right call. Separation between
the demo and the client is therefore a deployment boundary, not a row-level one:

|                | Demo                                    | Client               |
| -------------- | --------------------------------------- | -------------------- |
| Vercel project | existing                                | new                  |
| Neon database  | existing                                | new, its own project |
| Deploys from   | `main`                                  | `release`            |
| Domain         | `law-firmmanagementsystem.vercel.app`   | the firm's           |
| Demo sign-in   | on                                      | **off**              |
| Nightly reset  | on                                      | **off, twice over**  |
| Data           | fixtures for a firm that does not exist | privileged           |

Two databases rather than two schemas in one, because the failure mode of a
mistake is different in kind: a bad `DATABASE_URL` pointed at the wrong schema
is a bad afternoon, and pointed at the wrong _project_ it does not connect at
all. The demo's whole purpose is that strangers press destructive buttons in it.
Keep it in a different building.

**What this plan deliberately does not do** — see Phase E for when to revisit:
`firm_id` on every table, row-level security, subdomain tenant routing,
self-serve signup, per-firm billing.

---

## 1. Findings register

Five things found by reading the code that this plan exists to fix. Each one is
**closed by a step below** — the checkbox here means "this hazard no longer
exists", and the step is where the work is described. Do not copy the steps up
here; tick this box when the step it points at is done and verified.

Ordered by what hurts most if missed.

### ☐ F1 — The nightly reset follows the repository into the client's project

`vercel.json` is checked into this repo, so a second Vercel project built from
it **registers `/api/cron/reset` too**. That endpoint empties every table the
seed owns. `CronConfig` does fail closed today — no `CRON_SECRET`, no config,
503 before the seed is reached — and that is good design, but it means one
unset environment variable is the whole distance between a firm's trust ledger
and a nightly `DELETE`.

_Severity:_ total and irreversible. _Closed by:_ **A3** (a second, ANDed
control, placed in `resetDemoData` and not only in the route) and verified by
**C2** and **C4** — call the endpoint on the real deployment before there is any
data in it.

- [ ] Closed and verified

### ☐ F2 — There is no way to create a real user

`disableSignUp: true` in `src/infra/auth/options.ts`, and the only code path
that creates an account is the demo seed. On a fresh client database you can
migrate, and then you cannot sign in. `users_exactly_one_subject` also means a
login must point at an existing `advocates` or `clients` row, so this cannot be
worked around with a hand-written `INSERT`.

_Severity:_ blocking, and it bites at the worst possible moment — after you have
provisioned everything and want to show the firm their system.

_Closed by:_ **C0**. Build the script and test it on a scratch database
**before** C1, not after.

- [ ] Closed and verified

### ☐ F3 — The one-click switcher is a public session-minting endpoint

`signInAs` in `src/app/(auth)/sign-in/actions.ts` mints a session for any roster
key, including Managing Partner, with no password. `src/lib/demo.ts` carries the
shared password in source, and `src/app/(auth)/sign-in/page.tsx` prints it on
the page.

Not rendering the buttons does not close this: the server action is reachable
whether or not anything renders a form that posts to it.

_Severity:_ full account takeover of every role. _Closed by:_ **A4** — the guard
goes in the action, on the server, before the roster is resolved. Verified by
**C4**, by hand-posting to it.

- [ ] Closed and verified

### ☐ F4 — The flag must fail closed, or it makes things worse

`DEMO_DEPLOYMENT` defaults to `false`: an unset variable, a typo'd variable, one
someone deleted while tidying, and a brand-new Vercel project must all mean
"real deployment, affordances off".

Get this backwards and the flag is worse than no flag — a demo that quietly
becomes real is a breach; a real deployment that quietly stays real is a
Tuesday. Equally, do not "simplify" it to a required `Config.boolean` with no
default: that turns an unset variable into a startup crash on the client's
deployment.

_Severity:_ determines whether Phase A is protection or decoration. _Closed by:_
**A1**, and locked in by the test in **A6** that asserts refusal with the
variable unset.

- [ ] Closed and verified

### ☐ F5 — The repository will argue with itself

`CronConfig`'s doc comment currently reasons _against_ having a flag: _"a flag
is a second way for a control to be silently absent."_ That is correct, and
Phase A appears to contradict it.

The resolution is that `DEMO_DEPLOYMENT` is ANDed with the secret, never
substituted for it — a second control that is required alongside the first can
only be a second way to _refuse_, never a second way to be absent. Leave the old
comment standing and the next reader has to guess which of the two claims the
code means.

_Severity:_ low today, high the day someone acts on the stale comment. _Closed
by:_ **A2**.

- [ ] Closed and verified

---

## Phase A — Make the demo affordances impossible to ship by accident

**Demonstrates:** that the demo affordances are a build-time capability of one
deployment, not a convention everybody agrees to respect.

This phase closes **F1, F3, F4 and F5**. What makes them urgent together is that
all four are currently held off by nothing but an environment variable being
absent or a person remembering — and this repository is about to be cloned into
a second Vercel project where neither of those is guaranteed.

F1 is the one to be frightened of. The rest are recoverable.

### A1. A `DeploymentConfig` that says what kind of deployment this is

- [ ] Add `DeploymentConfig` to `src/infra/config.ts`, following the
      `Effect.Service` + `Config` shape every other service in that file uses.

```ts
export class DeploymentConfig extends Effect.Service<DeploymentConfig>()(
  "DeploymentConfig",
  {
    effect: Effect.gen(function* () {
      return {
        isDemo: yield* Config.boolean("DEMO_DEPLOYMENT").pipe(
          Config.withDefault(false),
        ),
      };
    }),
  },
) {}
```

**The default is the entire point.** `false` means an unset variable, a typo'd
variable, a variable someone deleted while tidying, and a fresh Vercel project
all describe a real deployment with the demo affordances off. The dangerous
direction is a demo that quietly becomes real; the safe direction is a real
deployment that quietly becomes... a real deployment. Absence must never mean
"demo".

- [ ] Write the doc comment in the style of its neighbours: state that the
      default is load-bearing and why, or the next person will "simplify" it to
      `Config.boolean` with no default and turn an unset variable into a startup
      crash on the client's deployment.

### A2. Amend the comment that argues against exactly this

`CronConfig`'s doc comment currently says, of not having a flag: _"a flag is a
second way for a control to be silently absent."_ That reasoning is correct and
this phase appears to contradict it. Resolve it explicitly rather than leaving
the repository arguing with itself.

- [ ] Update the `CronConfig` comment in `src/infra/config.ts` to say that
      `DEMO_DEPLOYMENT` is an **additional** condition, never an alternative
      one: the reset requires the secret **and** the flag. A second control that
      is ANDed cannot be a second way to be silently absent — it can only be a
      second way to refuse. That is the distinction that makes both comments
      true.

### A3. Gate the reset, in the runtime and not only in the route

- [ ] In `src/runtime/reset.ts`, make `resetDemoData` check `DeploymentConfig`
      and refuse before it runs `seed` when `isDemo` is false. Return the
      refusal as a value — the existing signature already hands failures back as
      an `Either`, so this fits.
- [ ] Log the refusal at `Error`. A reset that was attempted against a real
      deployment is not a routine "no": it means the demo cron is registered
      somewhere it should not be, and you want to find out from a log rather
      than from a customer.
- [ ] In `src/app/api/cron/reset/route.ts`, answer `404` — not `403` — when the
      deployment is not a demo. On a client installation the endpoint should not
      exist, and the route's own comment already establishes the principle that
      it says nothing that distinguishes one refusal from another.

Put the check **in `resetDemoData`, not only in the route**. The route is one
caller; the runtime function is the thing that empties the tables. Guard the
dangerous operation, not the door in front of it.

### A4. Gate the one-click sign-in

- [ ] `src/app/(auth)/sign-in/page.tsx` — render the `DemoAccounts` panel and
      the shared-password paragraph (line ~48) only when `isDemo`. The page is a
      Server Component, so read the config there and pass a boolean down.
- [ ] `src/app/(auth)/sign-in/actions.ts` — `signInAs` (line ~139) must refuse
      when `isDemo` is false, **on the server**, before it resolves the roster
      or touches `DEMO_PASSWORD`. Not rendering the buttons is cosmetics; the
      server action is a public endpoint that mints sessions and it is reachable
      whether or not anything renders a form that posts to it.
- [ ] Leave `src/lib/demo.ts` and `DemoAccounts.tsx` in place, unchanged. They
      are dead code on a client deployment and that is fine — deleting them
      would fork the codebase, which is the thing this whole plan exists to
      avoid.

### A5. Gate the seed's password provisioning

- [ ] `src/infra/seed/logins.ts` sets `DEMO_PASSWORD` on every account it
      creates (lines ~95 and ~122). Make the seed program refuse to run at all
      when `isDemo` is false, at its entry point in `src/infra/seed/program.ts`,
      so that `npm run db:seed` pointed at a client database stops before the
      wipe rather than after it.
- [ ] This is the same guard as A3 at a second entry point. The script and the
      cron both reach `seed`; guarding only one leaves the other.

### A6. The tests that make this real

The existing `src/infra/seed/demo.test.ts` asserts the roster matches what the
seed provisions. Add the inverse — that with the flag off, none of it works:

- [ ] `signInAs` refuses with `DEMO_DEPLOYMENT` unset, for a key that is
      otherwise valid. This is the single most important test in the phase: it
      is the one that fails if someone later "simplifies" the gate away.
- [ ] `resetDemoData` refuses with the flag unset, and **does not delete
      anything** — assert a row still exists afterwards, not merely that the
      call returned a failure.
- [ ] The sign-in page renders no demo panel and no password with the flag
      unset.
- [ ] The seed refuses with the flag unset.
- [ ] Check whether `src/architecture.test.ts` or `eslint.boundaries.mjs` need
      to know about the new config dependency in `src/runtime/` and `src/app/`.

- [ ] `npm run verify`
- [ ] Set `DEMO_DEPLOYMENT=true` on the existing Vercel demo project **and in
      `.env.local`**, then confirm the demo still behaves exactly as before.
      Deploy it. Phase A is not done until the demo is proven unbroken.

### A7. Record the decision

- [ ] Amend `docs/adr/0013-one-click-demo-access.md`. Do not supersede it — the
      reasoning still holds for the deployment it was written about. Add a
      section saying the affordances it describes are now conditional on
      `DEMO_DEPLOYMENT`, and why the default is `false`.
- [ ] Note in `ROADMAP.md` §8 that the system now distinguishes deployment kinds.

---

## Phase B — Separate the product's name from the customer's name

**Demonstrates:** that this is a product with an installation, not a bespoke
build with a customer's name compiled into it.

`OKLaw` currently means two different things and the code cannot tell them
apart:

- **The product** — the thing you built and may sell again. `ServiceIdentity`'s
  `name: "oklaw"` in telemetry, `COOKIE_PREFIX`, the package name, the design
  system's CSS comments. All of these should stay exactly as they are.
- **The customer firm** — the fictional "OKLaw Advocates" whose fixtures fill
  the demo. This is what a real firm replaces, and it is what must become
  configuration.

The render sites where the _firm_ name appears:

| File                                                      | What it is                                    |
| --------------------------------------------------------- | --------------------------------------------- |
| `src/components/Topbar.tsx:87`                            | the wordmark on every internal page           |
| `src/components/PortalShell.tsx:41`                       | the wordmark on every client-portal page      |
| `src/app/layout.tsx:21,23`                                | page title and meta description               |
| `src/app/(auth)/sign-in/page.tsx:10,37`                   | title and card kicker                         |
| `src/app/portal/page.tsx:31`                              | "…at OKLaw" in the greeting                   |
| `src/app/portal/messages/page.tsx:43`                     | "Your correspondence with OKLaw"              |
| `src/app/(internal)/communications/page.tsx:59`           | "through OKLaw" — means _through this system_ |
| `src/app/(internal)/communications/LogContactForm.tsx:50` | "outside OKLaw" — same                        |
| `src/app/icon.svg`                                        | `aria-label`, and the mark itself             |

The last three are prose about the _system_, not the firm. Read each one and
decide which sense it is in; two of them read better reworded than
parameterised.

### B1. Firm identity as deployment configuration, not a table

- [ ] Add `FirmIdentity` to `src/infra/config.ts`: `name` (full legal name, e.g.
      "Kimani & Otieno Advocates"), `shortName` (the wordmark, ~12 characters),
      and default both to the current values so the demo needs no new variables
      to keep working.

**Configuration rather than a `firm_settings` table, deliberately.** One
deployment serves one firm — that is the architecture — so the firm's name is a
property of the deployment, and a table would imply a runtime editability that
nothing in the system currently offers. The table becomes right when a managing
partner should be able to change the letterhead without you deploying, which is
a real feature to sell later and roughly a day's work (migration, repository,
service, policy, form). It is not blocking client #1, and building it now would
push Phase C out by a day for nothing.

- [ ] Write that tradeoff into the doc comment so the future upgrade is a
      decision someone makes rather than a rewrite they discover.

### B2. Replace the render sites

- [ ] Work down the table above. Server Components read `FirmIdentity` directly;
      for anything client-side, pass it from the layout rather than reaching for
      a context.
- [ ] `src/app/icon.svg` — leave for now, and put "replace the favicon and
      wordmark mark" on the client onboarding checklist in Phase C. A per-deploy
      SVG is a build concern and not worth solving before you know what the firm
      hands you.

### B3. Explicitly leave alone

- [ ] `COOKIE_PREFIX` in `src/infra/auth/options.ts`. `src/proxy.ts` depends on
      the same literal, the two deployments are on different domains so there is
      no collision to solve, and changing it per-deploy buys nothing and risks
      the session check.
- [ ] `ServiceIdentity.name` in `src/infra/config.ts`. Traces should say which
      _product_ emitted them. When you have three installations you will want
      them distinguishable, and the right tool for that is a separate
      `firm.name` span attribute — not renaming the service.
- [ ] The `@oklaw.co.ke` addresses throughout `src/lib/data/*` and
      `src/infra/seed/*`. That is demo fixture data for a firm that does not
      exist. It never runs on a client deployment.

- [ ] `npm run verify`, then deploy the demo and confirm nothing moved.

---

## Phase C — Stand up the client installation

**Nothing in this phase happens until Phases A and B are deployed and verified
on the demo.**

### C0. First, the gap that will otherwise stop you dead

`disableSignUp: true` in `src/infra/auth/options.ts`, and the only code path
that creates a user is the demo seed. **There is currently no way to create a
real account on a fresh database.** You will hit this after provisioning
Postgres, at exactly the moment you want to show the firm their system.

- [ ] Write `scripts/provision-admin.ts` and a `npm run provision:admin` script.
      It takes a name, an email and a role, creates the `advocates` row and the
      linked `users` row through `UserRepository` — the same path
      `src/infra/seed/logins.ts` uses, for the same reason: `users_exactly_one_subject`
      refuses an unlinked row, so the link cannot be skipped.
- [ ] It must **not** wipe anything, must refuse if the email already exists,
      and must take the password from a prompt or an env var — never a default,
      and never anything written into the repository.
- [ ] Test it against a scratch database before you point it at the client's.
- [ ] Decide now how staff #2 through #12 get created. If it is this script,
      that is you running a terminal command every time the firm hires someone,
      and you should say so in the contract. A "add member of staff" screen for
      a Managing Partner is the obvious next feature and probably the first
      thing they ask for.

### C1. Database

- [ ] New Neon **project** (not a branch, not another database in the demo
      project), region closest to Nairobi.
- [ ] Confirm the plan's point-in-time-recovery window. A firm's trust ledger
      with no PITR is not something to discover you need.
- [ ] `DATABASE_URL` and `DATABASE_URL_UNPOOLED` from the new project.
- [ ] `npm run db:migrate` against it. **Do not run `npm run db:seed`** — after
      A5 it will refuse, and that refusal is the phase working.

### C2. Vercel project

- [ ] Create a second Vercel project from this same Git repository.
- [ ] Set its production branch to `release`. Create the branch from `main`.
- [ ] Protect `release` — no direct pushes, merges from `main` only.
- [ ] Confirm the reset cron: it will be registered from `vercel.json`, and it
      must answer 404 (A3) with no `CRON_SECRET` and no `DEMO_DEPLOYMENT`.
      **Verify this by calling it, on the real deployment, before there is any
      data in it.** This is the single most important check in the plan.

### C3. The environment matrix

Fill this in and keep it as the record of what is set where:

| Variable                        | Demo       | Client                         |
| ------------------------------- | ---------- | ------------------------------ |
| `DEMO_DEPLOYMENT`               | `true`     | **unset**                      |
| `CRON_SECRET`                   | set        | **unset**                      |
| `DATABASE_URL`                  | demo Neon  | client Neon                    |
| `BETTER_AUTH_SECRET`            | its own    | **its own, freshly generated** |
| `BETTER_AUTH_URL`               | demo URL   | the firm's domain              |
| `FIRM_NAME` / `FIRM_SHORT_NAME` | defaults   | the firm's                     |
| `BLOB_READ_WRITE_TOKEN`         | demo store | **its own store**              |
| `OTEL_*`                        | current    | decide: same backend or none   |

- [ ] Never reuse `BETTER_AUTH_SECRET` between the two. A shared signing secret
      means a session cookie minted by the public demo — where anyone can become
      a Managing Partner in one click — is a structurally valid cookie for the
      client's deployment. Different domains make it awkward to exploit, not
      impossible, and "awkward" is not a security control.
- [ ] Separate Blob store. Documents in the demo are fixtures; documents in the
      client's are privileged, and the reset's own comment notes that the wipe
      deliberately does not reach into blob storage.

### C4. Go-live verification

Run this against the client deployment, in order, before a single real record
goes in:

- [ ] `/api/cron/reset` returns 404.
- [ ] The sign-in page shows no role buttons and no password.
- [ ] `POST` to the `signInAs` server action, by hand, with a valid roster key —
      it must refuse. Do this even though the buttons are gone. Especially
      because the buttons are gone.
- [ ] `/api/auth/sign-up/email` refuses.
- [ ] The firm's name renders in the topbar, the portal, the tab title and the
      sign-in card.
- [ ] Sign in as the provisioned admin, confirm the dashboard is empty rather
      than full of fixtures.
- [ ] Confirm the audit log is recording — it is your evidence if anything is
      ever disputed.
- [ ] Take a backup and **restore it to a scratch database**. An untested backup
      is a belief, not a backup.

### C5. Operating it

- [ ] Write down the release procedure: `main` → PR into `release` → preview →
      merge. One paragraph in `README.md` is enough, but it must exist, because
      the failure mode is you pushing an experiment straight to a law firm at
      11pm.
- [ ] Never point the portfolio, the README or a screenshot at the client
      deployment. The public demo stays fictional, permanently.
- [ ] Regenerate `docs/images/*` from the demo only.

---

## Phase D — The commercial half, which is due before Phase C

**Do this before you invoice, not before you go live.** It is ten minutes now
and unwindable never.

- [ ] **Ownership.** A default work-for-hire arrangement means the firm owns what
      you build and you cannot sell it again — and you would find that out after
      building the product. You want: you retain copyright in the software; the
      firm receives a perpetual, non-exclusive licence to use it; you may reuse
      the underlying framework and any generic improvement. State it in writing
      before money moves.
- [ ] **Their data is theirs.** Say so explicitly and separately from the
      software licence. It is the clause that makes the ownership clause
      palatable, and it happens to be true.
- [ ] **Data protection.** Kenya's Data Protection Act 2019 applies, over the
      top of advocate–client privilege. You are a processor acting for the firm
      as controller: you need a data processing agreement, and check the current
      ODPC registration threshold to see whether you must register.
- [ ] **Scope and support.** What "a bug" means versus "a new feature", response
      expectations, and who pays for Neon and Vercel. Ambiguity here is what
      turns a first client into unpaid permanent on-call.
- [ ] **An exit.** If they leave, they get a database dump in a documented
      format within N days. Cheap to promise, and it is the thing that makes a
      cautious firm sign.

---

## Phase E — What comes after, and when

Do not start any of this now. The triggers are what matter.

**At 2–3 clients — one deployment, a database per firm.** Resolve the tenant
from the subdomain at the connection boundary. The schema is untouched, no
`firm_id` retrofit, and it is much cheaper than it sounds because
`src/infra/sql/pool.ts` is already the single place a connection is made. The
trigger is N Vercel projects becoming annoying to update, and you will know.

**Only for self-serve signup — true multi-tenancy.** `firm_id` on all 23 tables,
row-level security, every repository touched. Two invariants get materially
harder, and they are your two best pieces of work: conflict checks must scope
per firm, and the Rule 10 trust trigger must hold per firm rather than globally
(see `docs/case-study-trust-accounting.md`). Do not pay this until a paying
customer requires it.

**A "firm settings" screen** (B1's table) — the first time a customer asks to
change their own letterhead.

**A staff management screen** — the first time C0's script becomes tedious,
which will be soon.

---

## Order of work, condensed

1. Phase D's ownership clause — it costs ten minutes and gates everything.
2. Phase A, deployed to the demo and verified there.
3. Phase B, deployed to the demo and verified there.
4. Phase C0 — the admin provisioning script, on a scratch database.
5. Phase C1–C4 — the client installation, verified empty before it holds
   anything.
6. Phase C5 — write down how you ship to them, before you need to.

Every finding in §1 should be ticked by the end of step 5. If any is still open
when real data goes in, stop and close it first — F1 and F3 in particular are
not things to carry into production and fix afterwards.
