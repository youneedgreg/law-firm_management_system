# 12. Design tokens as primitives and roles

**Status:** Accepted · **Date:** 2026-08-22 · **Extends:** ADR 0007

## Context

ADR 0007 decided to keep the wireframe's hand-written CSS rather than replace it
with a component library. That decision held, and it produced the problem this
one solves.

By the end of Phase 7 the two stylesheets contained **twenty-four ad-hoc
`color-mix()` expressions at ten different ink strengths**, each one locally
reasonable and none of them accountable to anything. There was no answer to the
question "may I use this colour here", so every screen answered it again.

Measuring them turned tidying into a bug hunt. Five of the transparency levels
and one ramp step were being used as text, and they measured between **3.1:1 and
4.2:1** against the page — under the 4.5:1 that WCAG 2.2 AA asks for. They were
not a hierarchy; they were one role rendered five ways at increasingly
unreadable contrast. The primary button — the most-pressed control in the
application — was failing at 3.7:1. Every form control was drawn with a hairline
at 1.4:1 against a fill that sat within 1.1:1 of the page behind it, so nothing
but that border said where the control was.

None of this was visible to review. A contrast failure looks like a design
choice.

## Decision

Custom properties are split into two kinds, and the distinction is enforced.

**A primitive says what a colour is.** `--color-neutral-600` is a value on a
ramp. Primitives may be referenced only by roles.

**A role says what a colour is for, and carries a contrast obligation.**
`--ink-muted` is text, and its documented figure is measured at its _worst_
ground. Components reference roles and never primitives.

Three rules follow from that split:

1. **There are exactly four ink roles, and no fifth.** A light newsprint ground
   has room for four readable greys; depth below `--ink-muted` is carried by
   size, case and tracking, which is what was doing the work anyway.
2. **Ink roles are opaque.** A transparent ink is a different colour on every
   ground — 55% ink measures 3.65:1 on the page, 3.56:1 on a card and 3.67:1 in
   a tag — so "does it pass" has one answer per ground and nobody re-measures
   when a component moves. Washes stay transparent, because a wash has to work
   over a row, a card and a button at once and is never text.
3. **Both themes are declared once per token**, with `light-dark()`. The usual
   arrangement writes the whole palette twice, once in a `prefers-color-scheme`
   media query and once under `[data-theme]`, and that is where the copies
   drift. Here `color-scheme` chooses and there is one declaration.

`src/app/tokens.test.ts` parses the real stylesheets — not a copy — and asserts
the contrast figures, the primitive/role separation, and that every `var(--…)`
and every class name used in `src/` actually resolves. It resolves
`light-dark()` itself and runs every assertion against both palettes.

## Rationale

### Why a test rather than a linter or a convention

An undefined custom property is not an error in CSS. It invalidates the one
declaration it appears in and the browser moves on, silently. That is not a
theoretical hazard here: `--space-5` had never been defined and seven screens
used it, so they had no margin. The billed-against-collected chart on `/reports`
drew its bars in `var(--ink)` and `var(--accent)` when neither existed, so
**both bars were transparent** — on a page whose figures had already been
verified in a browser. A table can be right while the chart beside it draws
nothing.

The same hazard exists one namespace over: an unknown class name is not an
error either, so `.form-error` — which carried the sign-in refusal — rendered as
ordinary body text. Four class names were used and never defined.

Neither failure is visible to a linter, to TypeScript, or to a person looking at
the screen they happened to be working on. Parsing the stylesheet is the only
thing that catches them.

### Why dark mode belongs in this ADR

Because it is what proved the split was real. The primitives/roles rule had been
enforceable for `color:` and not for `background:`, because three grounds and
all three tags named ramp steps as fills and there was no principled reason to
stop them. Two palettes settled the argument: a ramp step's value is fixed, so a
tag that must be dark-on-light in one theme and light-on-dark in the other
**cannot** be written that way. Six `--tag-*` roles and four fill roles exist
because of it, and the documented tag exception is gone rather than
grandfathered.

The best result fell out of the same logic: `--ink-inverse` needs no dark value
at all. The page ground is the right label colour on a saturated fill in both
themes, because the fill moves to the other end of its ramp when the ground
does. `--line-control` needs no dark value either — the middle of a ramp is the
one place that clears 3:1 against both ends of it.

### What was rejected

**Adopting a token system wholesale** (Radix Colors, Open Props). Both are good
and both would have replaced a distinctive editorial palette with a generic one,
which is the thing ADR 0007 exists to prevent. The scales here are derived from
the wireframe's own colours.

**Fixing the contrast failures without the split.** It would have worked once.
The twenty-four ad-hoc mixes accumulated precisely because there was no rule
about what may be used where, and re-measuring six values without adding one
would have left the next twenty-four to accumulate.

**Grandfathering the tags.** They were the loudest argument for keeping ramp
steps as fills, and the two-palette requirement is what made them impossible to
defend.

## Consequences

- A component may reference roles only. Reaching for a primitive fails
  `tokens.test.ts`, with the role that should have been used named in the
  message.
- Every contrast figure in the stylesheet's comments and in
  `docs/design-system.md` is asserted against the value beside it, so the
  documentation cannot drift from the sheet.
- Adding a colour means adding a role and its contrast measurement, which is
  more work than adding a `color-mix()` and is the point.
- Table row dividers are a documented exemption: they stay hairlines and the
  test asserts they _fail_ 3:1, so nobody later "fixes" the dividers into a
  cage.
- Lighthouse scored Accessibility 96 on the previous build with twelve nodes of
  insufficient contrast, and 100 on this one — the same defect found from the
  other direction, which is the closest thing to independent confirmation
  available here.
