# 1. Record architecture decisions

**Status:** Accepted · **Date:** 2026-08-18

## Context

This system is built partly as a portfolio piece. The reasoning behind a design
is at least as interesting as the design itself — a reader can see _what_ the
code does by reading it, but not _why_ it is that way, or what was rejected.

Decisions also decay. Six months in, "why is auth self-hosted?" is a question
whose answer lives only in memory, and memory is where architectures go to rot.

## Decision

Every architecturally significant decision gets a numbered Markdown file in
`docs/adr/`, following Michael Nygard's format: Context, Decision, Consequences.

A decision is architecturally significant if reversing it later would be
expensive: choice of framework, persistence, auth, layering, or a deliberate
scope boundary.

ADRs are immutable once accepted. A decision that changes gets a _new_ ADR that
supersedes the old one, and the old one is marked `Superseded by ADR-NNNN`.
Editing history to look prescient defeats the purpose.

## Consequences

- Overhead of roughly fifteen minutes per significant decision.
- A reviewer can reconstruct the reasoning without an interview.
- `ROADMAP.md` §8 acts as the running log; ADRs are written up from it.
