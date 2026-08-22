# 13. One-click demo access, without a second way in

**Status:** Accepted · **Date:** 2026-08-22 · **Decision IDs:** D-5 ·
**Implements:** ADR 0008

## Context

ADR 0008 decided that the live demo would have one seeded account per role, a
one-click switcher, and a nightly reset. That was a plan; this is what building
it actually required, and two of the three parts turned out to have security
consequences the plan did not anticipate.

The reasoning behind the switcher has not changed. Open signup lands a reviewer
on an empty dashboard, which demonstrates nothing. A single read-only guest
account hides the seven-role authorization model, which is one of the more
substantial pieces of work in the system. What a reviewer sees in the first ten
seconds is the whole argument, and asking them to type an address and a password
they have to scroll to find is a tax on that.

But a button that signs somebody in is an unauthenticated endpoint that mints
sessions, and the obvious implementations of it are all worse than the form they
replace.

## Decision

**The switcher is the same sign-in.** A button posts a _key_ —
`finance-officer` — which `src/lib/demo.ts` resolves to a seeded address. The
action then calls `IdentityService.signInAsDemo`, which is
`signIn` with one extra counter in front of it: the password is
checked by the same gateway, the attempt is audited by the same code, the
session is issued the same way. There is no demo branch inside the services and
no second door.

**One counter that success does not clear.** `signIn` forgets its rate-limit
buckets on a successful attempt, which is right when success means somebody
proved who they are and wrong here, where every press succeeds. So
`Throttle.forDemo` adds a bucket keyed on the source alone that is **never
forgotten** — thirty presses per fifteen minutes, set for a person clicking down
a roster of six rather than for a fleet.

**The roster is one list, checked against the seed.**
`src/infra/seed/demo.test.ts` asserts that every address on the sign-in page is
an account the seed provisions, holding the role claimed beside it, and that
every role the firm employs has a button.

**The nightly reset runs the same program as `npm run db:seed`**, triggered by a
Vercel cron at midnight UTC against `/api/cron/reset`, which refuses without the
platform's shared secret.

## Rationale

### Why a key and not the credentials

The button could have carried the address and the password in hidden fields —
both are printed on the page a few centimetres above it. A key is better anyway,
because it makes the set of accounts this endpoint will sign in as a closed list
in the source rather than whatever the form happened to submit. An unknown key
is refused, not attempted.

### Why not a "demo mode" that skips the password

Because every version of it is a way into the application that does not involve
checking a credential, and that code would exist in the deployed artefact
whether or not a flag was set. The published password costs nothing here — the
accounts are fixtures for a firm that does not exist — and keeping the real
check means there is nothing to remember to remove.

The `services/` layer may not import `lib/`, so the demo password cannot reach
`IdentityService` even by accident. That boundary is doing real work in this
one instance: a service that knew a password would be a service with a way in
that does not involve checking one.

### Why the reset endpoint fails closed on a missing secret

Vercel sets `Authorization: Bearer $CRON_SECRET` on cron invocations when the
variable exists and sets nothing when it does not — so "unset" must mean the
endpoint refuses, never that it runs unauthenticated. `CronConfig` reads the
secret as _required_, so a deployment without one produces no config and the
route answers 503 without reaching the seed. There is no flag to disable the
check, for the same reason Phase 8 gave for having no flag on tracing: a flag is
a second way for a control to be silently absent.

The comparison is timing-safe over SHA-256 digests rather than over the values,
which fixes two things at once — `timingSafeEqual` throws on buffers of
different lengths, and that would leak the secret's length through a 500.

### What the reset costs, stated rather than discovered

The seed wipes `users`, and sessions cascade from it, so anybody signed in at
midnight is signed out mid-page. For a demonstration that is a quirk; in a real
system it is the reason a reset like this would never be pointed at production.

The trail deliberately survives. `audit_log` refuses `DELETE` outright and the
wipe does not touch it, so the record of what a visitor did outlives the records
they did it to — Phase 6's guarantee holding under the one operation that would
most like an exception from it.

## Consequences

- A reviewer reaches a populated dashboard, as any of six roles, in one click.
- Every one-click sign-in appears in the audit trail as `session.signed-in`,
  attributed to the real principal, indistinguishable from a typed one —
  verified in the browser against the deployed database.
- `CRON_SECRET` must be set in the production environment or the reset silently
  does not happen. The 503 is logged; nothing else reports it.
- The demo database is shared by preview and production (see ROADMAP §Phase 2),
  so the reset resets both. Per-preview Neon branches are the upgrade if preview
  ever writes.
- Removing the whole feature means deleting `src/lib/demo.ts` and the panel that
  reads it. Nothing in `services/` or `infra/` would need to change.
