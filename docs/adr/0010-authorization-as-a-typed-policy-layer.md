# 10. Authorization as a typed policy layer

**Status:** Accepted · **Date:** 2026-08-20

## Context

Phase 6 adds seven roles and a client portal. The portal is the part that
matters: a client signs in and must see their own matters, their own fee notes,
and nothing whatever of the other five clients'. A mistake there is not a bug
report, it is a disclosure of privileged material — for a law firm, even the
_existence_ of a matter is confidential.

The conventional Next.js arrangement is middleware that "protects" routes, plus
`getSession()` calls sprinkled through the pages that need one. It fails in
three predictable ways:

1. **Middleware is not on every path.** A Server Action does not pass through
   it. Neither does a route the matcher does not cover, or a service called from
   somewhere new.
2. **Nothing marks the checks that were forgotten.** `getSession()` returning
   `User | null` is advisory; a page that never calls it compiles, renders, and
   serves data to anybody.
3. **The check and the query are separate.** Code that authorizes and then runs
   an unscoped `SELECT` looks correct in review, and is the single most common
   shape of this class of breach.

## Decision

Authorization is a **typed requirement in the service layer**, and nowhere else
is a security boundary.

- `CurrentUser` is an Effect `Context.Tag`. Every operation that checks a
  permission carries it in its `R` channel, so an effect cannot be run until a
  caller provides a principal. **Forgetting the check is a compile error at the
  call site**, not a review comment.
- `Principal` is a tagged union: `Staff` carries a role and an `AdvocateId`;
  `PortalUser` carries a `ClientId` and no role at all. There is no value that
  is both. The database enforces the same thing (`users_exactly_one_subject`).
- Permissions are **data**, not booleans on a row: one table from role to a
  closed union of `subject:verb` strings, in `domain/identity/permissions.ts`.
- Row-level access is a separate concept — `Scope`, either `WholeFirm` or
  `OneClient` — and it is applied **in the query**, not as a filter afterwards.
  A portal user's caseload is `forClient(id)`; the rows they may not see are
  never read.
- `proxy.ts` performs an optimistic cookie-presence check and is documented, in
  the file, as not a security boundary.

## Rationale

### Permission and scope are two different questions

A portal user genuinely holds `case:read` — the same permission the managing
partner reads the caseload with. The permission is not what protects the other
clients; the scope is. Conflating them produces one of two bugs: a portal that
cannot read anything, or a permission check that passes and a query that returns
the firm.

Both are required, they are checked separately, and the tests assert each
independently.

### An out-of-scope record is reported as absent

`withinScope` fails with `NotFound`, not `NotPermitted`. A truthful "you may not
see this matter" confirms the matter exists, and with it the client, and the
fact that this firm acts for them. Whether somebody is a client of a particular
practice is not a fact that should be derivable from the difference between two
status codes.

Staff are treated differently and deliberately: a Receptionist refused the fee
notes gets a 403 with the reason, because everyone at the firm already knows the
fee notes exist and concealing them would only be confusing. **Scope conceals;
permission explains.**

### The audit entry shares the mutation's transaction

Every write in `CaseService` and its audit entry go in through `Transactor` as
one unit. A trail written afterwards produces precisely the gap it exists to
close — a matter that was opened with no record of who opened it, on the one
occasion something went wrong.

`Transactor` is an interface declared in `services/` rather than a direct call
to `sql.withTransaction`, so the guarantee is testable without a database: the
in-memory implementation rolls the same stores back, and the test that breaks
the audit write asserts the matter does not survive it.

The session events are the stated exception. They are recorded _around_ an
operation this codebase does not own, and a failure to record one is logged
rather than propagated: refusing to let anybody sign in because a log table is
unavailable would be an outage caused by the safeguard.

### The System Administrator is not a superuser

They manage logins and read the audit trail. They do not file in court, and they
do not touch client money — in a real firm they are not an advocate. An
administrator account that can do everything is the most valuable thing an
attacker can take, and this was the phase to decide it cannot be.

### Better Auth is kept to the part it is here for

Session verification and password hashing, behind a `SessionGateway` interface
declared in `services/` (ADR 0004). Everything else — who the principal is, what
they may do, what is recorded — is this codebase's. The tables live in our
migrations, in snake_case, and `auth-schema.test.ts` asks the library itself
which columns it needs and compares them against the DDL, so a field added by a
future version fails a test instead of a query.

Sign-in and sign-out are refused by the catch-all `/api/auth` route and served
only by the Server Actions, because both are audited there. One door per
operation, so there is no second path that leaves no trace.

## Consequences

**Accepted costs:**

- Every service operation's type mentions `CurrentUser`, and every call site
  provides one. That is the mechanism working, but it is visible noise in
  signatures and it made every existing test change.
- Two refusal vocabularies (`NotPermitted`, and `NotFound` standing in for a
  scope refusal) must be understood together; the 404 reads as a bug until the
  reasoning is known, which is why it is written down in three places.
- The permission table is a second thing to keep in step with the nav's role
  allow-lists, which still gate the twenty mock modules that have no service
  behind them yet. They agree today; the service is what decides.
- Reaching `auth.$context.password` in the seed uses Better Auth internals,
  which carry no compatibility promise. The alternative was hashing passwords
  ourselves, which ADR 0004 rejected.

**Gained:**

- A route, an action, or a service added later cannot read data as nobody: it
  will not compile.
- The portal's isolation is proven by tests that _attempt_ the cross-client read
  — as a valid signed-in user of the system, which is the shape of the real
  attack — at the service layer and again over HTTP.
- Every mutation has an actor, atomically, and the trail cannot be edited: a
  trigger refuses `UPDATE` and `DELETE` on `audit_log`.
