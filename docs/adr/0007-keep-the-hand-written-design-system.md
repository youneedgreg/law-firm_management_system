# 7. Keep the hand-written design system

**Status:** Accepted · **Date:** 2026-08-18 · **Decision ID:** D-6

## Context

The prototype ships roughly 1,200 lines of hand-written CSS implementing a
distinctive editorial "broadsheet" look. The default move at this point would be
to migrate to Tailwind with shadcn/ui components.

## Decision

Keep the hand-written CSS. Formalize it in Phase 9 by extracting design tokens
into documented custom properties and writing `docs/design-system.md`.

Headless primitives may be introduced _only_ where hand-rolling accessibility is
genuinely difficult — dialog, combobox, date picker. Layout, typography, and
visual identity stay hand-written.

## Rationale

Rewriting working, attractive CSS produces no reviewer value: the app looks the
same at the end, minus several weeks. And a large share of portfolio projects
are visually identical because they all use the same component library. Looking
different is worth something on its own.

The counter-argument — that Tailwind plus shadcn gives accessible primitives for
free, which helps the WCAG 2.2 AA target in Phase 9 — is real but narrow. It
applies to a handful of complex widgets, not to the whole stylesheet, and the
carve-out above addresses exactly those.

## Consequences

- Accessibility is our own responsibility, and Phase 9 budgets an audit for it.
- New UI is slower to write than with utility classes.
- The design system must be documented, or its conventions live only in the
  author's head.
- Mixing hand-written CSS with headless primitives risks visual inconsistency at
  the seams; primitives are restyled to match rather than used with stock styles.
