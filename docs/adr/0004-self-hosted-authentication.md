# 4. Self-hosted authentication with Better Auth

**Status:** Accepted · **Date:** 2026-08-18 · **Decision ID:** D-2

## Context

The system has seven roles and a client portal where an authorization failure
means one client seeing another's confidential matter. Three options were
weighed:

1. **A managed provider** (Clerk, available natively through the Vercel
   Marketplace) — fastest, with MFA and social login included.
2. **Better Auth, self-hosted** — sessions and users as rows in our own Postgres.
3. **Hand-rolled** — Argon2, session tokens, rotation, CSRF, all bespoke.

## Decision

Better Auth, with users and sessions stored in the project's own Postgres.

## Rationale

A managed provider outsources precisely the part of this system that is worth
demonstrating. With Clerk, the `users` table becomes a webhook-synced shadow of
someone else's database, and role assignment, session lifecycle, and the audit
trail all end up split across a boundary we do not control. Those are the
interesting problems here, not incidental ones.

Hand-rolling was rejected for the opposite reason. Writing bespoke password
hashing for a system that tracks client trust funds signals poor judgment to a
reviewer even when the implementation happens to be correct. Knowing what _not_
to build from scratch is part of the skill being demonstrated.

Better Auth sits between: password handling, session tokens, and rotation are
handled by a maintained library, while the data model stays ours — joinable with
`advocates`, `cases`, and `audit_log` in a single query, and modellable in
Effect like any other repository.

## Consequences

- Authorization is enforced in the service layer on every read, not in `proxy.ts`.
  Proxy handles optimistic redirects only; it is not a security boundary.
- Row-level authorization for portal users is tested adversarially: tests attempt
  the cross-client read and assert it fails.
- MFA and social login must be configured rather than inherited. Acceptable.
- Session and user tables participate in our own migrations.
