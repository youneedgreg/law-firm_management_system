# 8. Neon Postgres, Vercel Blob, and public demo access

**Status:** Accepted · **Date:** 2026-08-18 · **Decision IDs:** D-4, D-5, D-8

Three smaller infrastructure decisions, recorded together.

## Persistence: Neon Postgres on Vercel

Provisioned through the Vercel Marketplace. Postgres because the domain is
relational and the invariants belong in the database as constraints, not only in
application code. Neon because branching, a generous free tier, and native
Vercel integration remove operational work that would teach nothing here.

`@effect/sql-pg` connects to it, so the choice is also the path of least
resistance for ADR 0002.

## Document storage: Vercel Blob, private

Legal documents are confidential, so blobs are private-access with signed URLs
rather than public. Vercel Blob over S3/R2 because it needs no separate account,
credentials, or dashboard, and behaves identically in preview and production
deployments. Storing files in Postgres was rejected: it is the wrong tool at any
real size, and a reviewer will notice.

## Demo access: seeded accounts with a role switcher

The live demo has one seeded account per role and a one-click switcher on the
login page, over rich seeded data, reset nightly by a cron job.

The alternatives both fail the same test — what a reviewer sees in the first ten
seconds. Open signup lands them on an empty dashboard, which demonstrates
nothing. A single read-only guest account hides the seven-role authorization
model, which is one of the more substantial pieces of work in the system. The
switcher turns the RBAC implementation into something visible rather than
something claimed.

## Repository visibility: public from day one

The repository is public from the start rather than opened up once presentable.
Commit hygiene therefore matters immediately, and the progression from wireframe
to production system is itself part of what is being demonstrated. The cost is
that early, rougher commits stay visible — accepted, since the trajectory is the
point.

## Consequences

- `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN` are managed through `vercel env`
  and pulled locally; no secrets in the repository.
- The nightly reset job must be idempotent and must never run against anything
  but the demo environment.
- Public history means no force-pushing `main` and no rewriting shared commits.
