# 3. Single firm, not multi-tenant SaaS

**Status:** Accepted · **Date:** 2026-08-18 · **Decision ID:** D-1

## Context

A practice management system could serve one firm or many. Multi-tenancy would
mean a `firm_id` on every table, a tenant predicate on every query, tenant
context threaded through every service, and Postgres Row-Level Security policies
to make isolation enforceable rather than merely intended.

## Decision

The system serves a single firm. There is no `firms` table and no tenant column.

## Consequences

- Schema and queries stay legible; authorization reasoning has one axis (role
  and ownership) rather than two (tenant and role).
- Effort is redirected into domain depth — trust accounting, court hierarchy,
  statutory deadlines — which is where this system is actually interesting.
- Retrofitting multi-tenancy later would be a substantial migration. Accepted
  knowingly: this is a demonstration of depth, not a product seeking customers.
- **This is a deliberate boundary and is documented as one in the README.** An
  unbuilt feature that is explained reads as judgment; one that is merely absent
  reads as an oversight.
