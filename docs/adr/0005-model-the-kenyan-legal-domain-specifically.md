# 5. Model the Kenyan legal domain specifically

**Status:** Accepted · **Date:** 2026-08-18 · **Decision ID:** D-3

## Context

The prototype's seed data already implies a jurisdiction: Nairobi and Mombasa
courts, KES amounts, KRA PINs, M-Pesa payments, advocates rather than attorneys.
That could be generalised into a jurisdiction-neutral "legal practice" model, or
committed to and deepened.

## Decision

Commit to Kenyan practice and model it with real statutory detail.

Concretely, this means:

- **Court hierarchy as a tagged union**, not a string field: Supreme Court, Court
  of Appeal, High Court (with division), Magistrates' Courts (with tier and
  pecuniary jurisdiction limit), Employment and Labour Relations Court,
  Environment and Land Court. The model encodes which courts may hear which
  matters and up to what value.
- **Trust accounting under the Advocates (Accounts) Rules**: client funds are
  never commingled with firm funds, a client ledger can never go negative, and
  every movement is double-entry.
- **Statutory deadlines** computed from filing dates under the Civil Procedure
  Rules, excluding court holidays and vacation.
- **KRA PIN** validated by format, not accepted as free text.

## Rationale

A generic model is quicker and less interesting. Domain depth is the cheapest
available way to demonstrate seniority: it shows the ability to read a
specification, extract invariants, and encode them in types — which is the
actual job, and is what separates this from a CRUD app with a legal theme.

## Consequences

- **A research step precedes Phase 1 coding.** Roughly a week reading the Civil
  Procedure Rules, the Advocates (Accounts) Rules, and the court structure,
  written up in `docs/domain-notes.md` with citations.
- The repository is public, so this research is visible. Cite sources as you go:
  visibly incorrect statements about Kenyan procedure would undercut the
  credibility the depth is meant to buy.
- The model is not portable to other jurisdictions without rework. Accepted.
