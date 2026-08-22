# The Broadsheet design system

OKLaw is set in one serif on a newsprint ground, with two inks of colour. The
look is deliberate (ADR [0007](adr/0007-keep-the-hand-written-design-system.md)):
most portfolio projects are default shadcn, and an editorial identity that
someone actually drew is worth more than a component library everybody
recognises. This document is what makes it a _system_ rather than a stylesheet —
what each variable is for, what obligation it carries, and how to add one.

Two files hold all of it:

| File                     | Holds                                                                     |
| ------------------------ | ------------------------------------------------------------------------- |
| `src/app/broadsheet.css` | The tokens, and the component classes ported from the design project      |
| `src/app/globals.css`    | The application layer — shell, screens, and the controls Broadsheet omits |

Everything here is asserted by `src/app/tokens.test.ts`, which parses these two
files rather than a copy of their values. **Every contrast figure quoted below
is measured by that test**, so the document cannot quietly go out of date.

---

## 1. The one rule

**Primitives say what a colour is. Roles say what it is for, and carry the
contrast obligation that comes with the job. Rules read roles.**

```css
/* primitive — a value, with nothing asserted about it */
--color-neutral-700: #605d5d;

/* role — a job, with a bar it has to clear */
--ink-muted: var(--color-neutral-700); /* 5.4:1 on every ground */
```

A rule that reaches past the roles for a ramp step is a colour nobody has
measured. That is not a hypothetical: it is how this system acquired six
separate contrast failures, one commit at a time, each one locally reasonable.

**Dark mode is what made the second half of the rule enforceable.** For a while
the rule applied only to `color:`, because three grounds and all three tags were
naming ramp steps as fills and there was no principled way to stop them. Two
palettes settled it: a ramp step's value is fixed, so a tag that has to be
dark-on-light in one theme and light-on-dark in the other _cannot_ be written
that way. They are roles now, and `background:`, `border-color:` and
`outline-color:` are held to the same rule.

---

## 2. Two themes, one declaration each

Every colour role states both its values in one place:

```css
--ink: light-dark(var(--color-neutral-950), var(--color-neutral-100));
```

`light-dark()` resolves against the **used** `color-scheme`, so the theme
switch is a single declaration and there is no second copy of the palette. The
usual arrangement — the whole block once in a `prefers-color-scheme` media
query and again under a `[data-theme]` selector — is where the two copies
drift, and one of them is always the one nobody opens.

`color-scheme` is not only a signal to this stylesheet. The user agent reads it
too, and it is what keeps the native date picker, the select popup, the
scrollbars and the validation bubble in step with the page.

The choice has three states, and the third is not "unset":

| `data-theme` | `color-scheme` | Meaning                          |
| ------------ | -------------- | -------------------------------- |
| _absent_     | `light dark`   | Follow the machine — the default |
| `light`      | `light`        | Chosen                           |
| `dark`       | `dark`         | Chosen                           |

The attribute is written by an inline script in `app/layout.tsx` **before the
first paint**, from a choice in `localStorage`. It has to be inline and
synchronous: every other way of applying it runs after the first paint, so
somebody who chose dark gets a white page for a frame. Its documented cost is
one `suppressHydrationWarning` on `<html>` — the server cannot know a value
that only exists in the browser, so React finds an attribute it did not render
and would report it on every load.

## 3. Grounds

The three fills that text is ever set on, and the fixed points every ink role
is measured against.

| Token             | Light     | Dark      | Where                             |
| ----------------- | --------- | --------- | --------------------------------- |
| `--color-bg`      | `#f3f2f2` | `#1a1918` | The page                          |
| `--color-surface` | `#eae9e9` | `#262423` | Cards, dialogs, form controls     |
| `--color-inset`   | `#f8f4f4` | `#121110` | The sign-in ground, a neutral tag |

Light keeps Broadsheet's own arrangement — a raised surface is _darker_ than
the page and an inset one lighter — and dark inverts the direction while
keeping the relationship.

Every ink role clears its bar on **all three, in both themes**, and is quoted at
its worst. That is what lets a role be used anywhere without re-measuring, and
it is the whole argument for the next section.

---

## 4. Ink — the roles text is set in

| Token           | Light          | Dark           | Worst                        | Used for                             |
| --------------- | -------------- | -------------- | ---------------------------- | ------------------------------------ |
| `--ink`         | `neutral-950`  | `neutral-100`  | **13.7 · 14.2**              | Body text, headings, figures         |
| `--ink-muted`   | `neutral-700`  | `neutral-500`  | **5.4 · 5.4**                | Labels, hints, metadata, table heads |
| `--ink-link`    | `accent-700`   | `accent-400`   | **5.3 · 7.9**                | Links, the current nav item, kickers |
| `--ink-alert`   | `accent-2-700` | `accent-2-400` | **6.0 · 7.3**                | Refusals, overdue figures            |
| `--ink-inverse` | `--color-bg`   | `--color-bg`   | 5.7 · 9.0 on `--fill-accent` | A label on a saturated fill          |

`--ink-inverse` is the one role needing no dark value of its own, and the reason
is worth seeing: the page ground is the right label colour on a saturated fill
in _both_ themes, because the fill moves to the other end of its ramp when the
ground does. Dark ink on light teal, light ink on dark teal, one declaration.

### There are four, and there is no fifth

The system used to have nine ways to write muted text: five transparency levels
(50%, 55%, 60%, 65%, 70% ink) and four ramp steps. Measured, the picture was
that four of the transparency levels and `--color-neutral-600` all landed
between **3.1:1 and 4.2:1** — below the 4.5:1 that WCAG 2.2 AA asks for normal
text.

They were not a hierarchy. They were one role rendered at five different
degrees of unreadable. A light newsprint ground has room for about three
readable greys and this system uses all of them; **depth below `--ink-muted` is
carried by size, case and tracking**, which is how the design already
distinguished an 11px tracked uppercase table head from a 13px sentence-case
hint. Colour was never doing that work — it was only making the smaller thing
harder to read.

### Ink is opaque, on purpose

A transparent ink is a _different colour on every ground_: 55% ink measures
3.65:1 on the page, 3.56:1 on a card, 3.67:1 inside a tag. So "does it pass" has
one answer per ground, nobody re-measures when a component moves, and the
question quietly becomes unanswerable.

Each opaque role has exactly one answer. The cost is that ink cannot tint itself
to a coloured ground — which would matter if labels were set on the accent
fills, and none are: those surfaces (`.tag-accent`, `.day-today`) carry their
own paired foreground.

---

## 5. Colour that is not text

`--color-accent` (`#0088b0`) and `--color-accent-2` (`#d6006c`) are the brand at
full strength, and both are **non-text roles**. As a label on the page the teal
measures 3.4:1; that is why `--ink-link` exists and is a darker step of the same
ramp.

Where they belong is anything WCAG 1.4.11 governs at 3:1 — focus rings, the
caret, a bar in a chart, the tick in a checkbox. They clear it on every ground.

### Fills that carry a label

| Token                  | Light        | Dark         | vs `--ink-inverse` |
| ---------------------- | ------------ | ------------ | ------------------ |
| `--fill-accent`        | `accent-700` | `accent-400` | **5.7 · 8.9**      |
| `--fill-accent-hover`  | `accent-800` | `accent-300` | 8.8 · 12.0         |
| `--fill-accent-active` | `accent-900` | `accent-200` | 12.4 · 14.3        |

The hover and press steps move _away_ from the ground in each theme rather than
always downward, so a press reads as more emphatic in both instead of darker in
one and washed out in the other.

### Tags, which draw their own ground

`--tag-accent-fill` / `-ink`, `--tag-alert-fill` / `-ink`, `--tag-neutral-fill`
/ `-ink`. Each is a **pair**, measured against itself rather than against a
page, and each clears 9:1 in light and 11:1 in dark. They named ramp steps
directly until dark mode, which is the one thing a ramp step cannot do.

Separate from `--color-accent` because something is written on them, so the bar
is 4.5:1 rather than 3:1. `.btn-primary` — the most-pressed control in the
application — was the brand teal with a `--color-bg` label on it, at **3.7:1**.
One step down its own ramp clears it, which is what a tonal ramp is for, and the
button is recognisably the same button.

The notification badge is the interesting counter-example: it stays
`--color-accent-2`, because it measures 4.6:1 and **the next step down its ramp
is worse at 4.3:1**. Darkening by reflex would have broken it.

---

## 6. Lines

| Token                  | Bar                     | Used for                                    |
| ---------------------- | ----------------------- | ------------------------------------------- |
| `--line-control`       | **3.6 · 3.6**, required | Input, select, checkbox, button edges       |
| `--line-control-hover` | 8.3 · 7.7               | The same, hovered                           |
| `--line-soft`          | exempt                  | The hairline between rows, the sidebar edge |
| `--line-divider`       | exempt                  | Section rules, card edges, `.hr`            |
| `--line-rule`          | exempt                  | Rules between table rows                    |

`--line-control` is `--color-neutral-600` in **both** themes, which is not a
shortcut: the middle of a ramp is the one place that clears 3:1 against both
ends of it. The same fact is why there is no fifth ink role — that step reads
at 3.6:1 as text on light grounds and on dark ones alike.

A control's edge is the only thing saying the control is there, so 1.4.11
applies to it. That bar is load-bearing here rather than theoretical: the input
fill sits within **1.1:1** of the page it is on, so the fill is not
distinguishing anything and a 16%-ink hairline was not either.

A rule between two table rows carries nothing the text does not, so it is
exempt and stays a hairline. The test asserts that it _fails_ 3:1 — the
exemption is written down, so nobody later "fixes" the dividers into a cage.

---

## 7. Washes

`--wash-ink-faint` · `--wash-ink` · `--wash-ink-strong` · `--wash-accent` ·
`--wash-accent-strong` · `--wash-alert` · `--wash-selection` · `--wash-scrim`

The one place transparency is right. A wash is a tint laid over _whatever is
behind_ — a hover on a table row, a press on a button, the inert page under a
modal — so it has to work over every ground at once, and it is never text, so no
contrast bar applies to it.

Naming them also collapsed an accident: the modal backdrop was 50% and the
mobile navigation scrim was 30%, two numbers for one meaning. There is one
`--wash-scrim` now.

**The ink-tinted washes need no dark value at all**, and that is the payoff for
defining them against the role rather than against a literal: they are mixed
from `--ink`, which is already near-white in dark, so a hover that was 7% ink
over paper becomes 7% paper over ink with nothing added. The scrim is the
exception — it is not a tint of the foreground but the page being pushed back,
and on a dark page 50% of a dark grey pushes nothing.

---

## 8. Measure, type, elevation

**Space** is a 5px scale: `--space-1` … `--space-6`, `--space-8`. `--space-5`
was missing from the scale while seven screens used it anyway — an undefined
custom property is not an error, it invalidates the whole declaration, so those
seven had no margin at all. It is defined now, and `tokens.test.ts` fails on any
`var(--…)` in `src/` that does not resolve.

**Type** is one family: `--font-heading` and `--font-body` both read
`--font-source-serif`, published onto `<html>` by `next/font` in
`app/layout.tsx`. Headings take `--font-heading-weight` (600) and negative
tracking; `h6` is the exception, set small, uppercase and positively tracked,
which is the design's label voice.

**Elevation** is three ink-tinted shadows — `--shadow-sm` / `-md` / `-lg` —
derived from `--color-neutral-900` rather than from black, so a raised surface
reads as paper lifting off paper. On dark they are black at roughly three times
the strength: an ink tint on a dark ground is invisible, and a dialog still has
to sit off the page it covers.

---

## 9. Adding a token

1. **Is it a value or a job?** A new hue is a primitive and goes in a ramp. A
   new _use_ is a role, and needs a bar and a measurement.
2. **State the bar.** 4.5:1 if text will be set in it, 3:1 if it indicates
   something without words, none if it is decoration — and say which in the
   comment beside it.
3. **Give it both themes** with `light-dark()`, unless it genuinely has one
   value in each — `--line-control` and `--ink-inverse` are the only two, and
   both have a reason above.
4. **Add the assertion** to `src/app/tokens.test.ts` before the token is used
   anywhere. The test parses the stylesheet, resolves `light-dark()` itself,
   and measures **both** palettes.
5. **Break it once.** The three mutations that were run against this suite —
   pointing `--ink-muted` back at the failing ramp step, making one rule name a
   primitive, and misspelling a token — each fail exactly one test.

## 10. What is deliberately absent

- **A component library.** ADR 0007. The classes here are the system.
- **A colour for state other than the two brand hues.** No green success, no
  amber warning. A refusal is `--ink-alert`; everything else is ink. A law
  firm's screens are documents, and traffic lights read as an alarm panel.
- **Tokens for one-off measures.** `.topbar { height: 64px }` is not a token,
  because nothing else is ever that tall. A token with one caller is a name to
  maintain, not a system.
