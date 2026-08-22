import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The design system, checked.
 *
 * `docs/design-system.md` states what each role is for and quotes a contrast
 * figure for it. This file is what makes those figures true rather than
 * aspirational: it parses the real stylesheets — not a copy of the values —
 * resolves the tokens the way a browser would, and measures.
 *
 * Three kinds of assertion, and the third is the one that found live bugs:
 *
 *  1. **Each role clears its bar.** Text at 4.5:1 (WCAG 1.4.3), non-text
 *     indicators at 3:1 (1.4.11), on every ground it is allowed on.
 *  2. **Every `color:` in the sheets names an ink role.** Roles carry the
 *     obligation; a rule reaching past them for a ramp step is a value with
 *     nothing asserted about it, which is how the failures this layer fixed
 *     got in one at a time.
 *  3. **Every `var(--…)` anywhere in `src/` resolves.** An undefined custom
 *     property is not an error in CSS — it invalidates the whole declaration
 *     and the browser moves on. That is silent by construction, and it had
 *     already cost this codebase two live defects: `--space-5` was never
 *     defined and seven screens used it, so they had no margin; and the
 *     billed-against-collected chart on `/reports` drew its bars in
 *     `var(--ink)` and `var(--accent)` when neither existed, so both bars
 *     were transparent on a page whose figures had been verified in a
 *     browser. A table can be right while the chart beside it draws nothing.
 */

const dir = join(process.cwd(), "src/app");
const broadsheet = readFileSync(join(dir, "broadsheet.css"), "utf8");
const globals = readFileSync(join(dir, "globals.css"), "utf8");

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

// ── the token table, as the browser would build it ────────────────────────

function rootTokens(css: string): ReadonlyMap<string, string> {
  const block = /:root\s*\{([\s\S]*?)\n\}/.exec(stripComments(css));
  if (block?.[1] === undefined) throw new Error("no :root block");
  const tokens = new Map<string, string>();
  for (const decl of block[1].split(";")) {
    const at = decl.indexOf(":");
    if (at === -1) continue;
    const name = decl.slice(0, at).trim();
    if (name.startsWith("--"))
      tokens.set(
        name,
        decl
          .slice(at + 1)
          .trim()
          .replace(/\s+/g, " "),
      );
  }
  return tokens;
}

const TOKENS = rootTokens(broadsheet);

/** Straight-alpha sRGB, 0–1 per channel. */
interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/**
 * Which half of every `light-dark()` to take.
 *
 * The stylesheet declares both themes in one place and lets `color-scheme`
 * choose at paint time; this is the same choice, made here, so that every
 * assertion below runs twice against two different palettes.
 */
type Theme = "light" | "dark";
const THEMES: readonly Theme[] = ["light", "dark"];

/** Splits `light-dark(a, b)` on the top-level comma, which `a` may contain. */
function halves(inner: string): readonly [string, string] {
  let depth = 0;
  for (let at = 0; at < inner.length; at += 1) {
    const ch = inner[at];
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (ch === "," && depth === 0)
      return [inner.slice(0, at), inner.slice(at + 1)];
  }
  throw new Error(`light-dark() with one argument: ${inner}`);
}

function resolve(value: string, theme: Theme, depth = 0): Rgba {
  if (depth > 10) throw new Error(`cyclic token: ${value}`);
  const text = value.trim();

  const ref = /^var\((--[a-z0-9-]+)\)$/.exec(text);
  if (ref?.[1] !== undefined) {
    const next = TOKENS.get(ref[1]);
    if (next === undefined) throw new Error(`undefined token ${ref[1]}`);
    return resolve(next, theme, depth + 1);
  }

  const themed = /^light-dark\((.*)\)$/s.exec(text);
  if (themed?.[1] !== undefined) {
    const [light, dark] = halves(themed[1]);
    return resolve(theme === "light" ? light : dark, theme, depth + 1);
  }

  // The only mix form the sheets use, and the only one worth supporting: a
  // colour laid over whatever is behind it at some strength.
  const mix = /^color-mix\(in srgb, (.+?) (\d+)%, transparent\)$/.exec(text);
  if (mix?.[1] !== undefined && mix[2] !== undefined) {
    const base = resolve(mix[1], theme, depth + 1);
    return { ...base, a: base.a * (Number(mix[2]) / 100) };
  }

  const hex = /^#([0-9a-f]{6})$/i.exec(text);
  if (hex?.[1] !== undefined) {
    const n = parseInt(hex[1], 16);
    return {
      r: ((n >> 16) & 255) / 255,
      g: ((n >> 8) & 255) / 255,
      b: (n & 255) / 255,
      a: 1,
    };
  }

  throw new Error(`cannot resolve ${text}`);
}

const token = (name: string, theme: Theme): Rgba =>
  resolve(`var(${name})`, theme);

/** Source-over compositing: what the eye actually receives. */
function over(fg: Rgba, bg: Rgba): Rgba {
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  };
}

const channel = (c: number) =>
  c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

const luminance = (c: Rgba) =>
  0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);

/** WCAG 2.x relative-luminance contrast, with any alpha resolved over `bg`. */
function contrast(fg: Rgba, bg: Rgba): number {
  const [light, dark] = [luminance(over(fg, bg)), luminance(bg)].sort(
    (a, b) => b - a,
  );
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

/**
 * The three fills text is ever set on. Every ink role is measured against all
 * three and quoted at its worst, so a role can be used anywhere without
 * re-measuring — which is the entire reason the ink roles are opaque.
 */
const GROUNDS = ["--color-bg", "--color-surface", "--color-inset"];

const worstGround = (name: string, theme: Theme) =>
  Math.min(
    ...GROUNDS.map((g) => contrast(token(name, theme), token(g, theme))),
  );

// ── 1. every role clears its bar ──────────────────────────────────────────

describe.each(THEMES)("%s theme", (theme) => {
  describe("ink roles are readable on every ground", () => {
    // 1.4.3 Contrast (Minimum), AA, normal-size text. The figures the
    // stylesheet quotes beside each role are checked against the measurement,
    // in both palettes, so a comment cannot drift from the value beside it.
    it.each([
      ["--ink", { light: 13.7, dark: 14.1 }],
      ["--ink-muted", { light: 5.3, dark: 5.3 }],
      ["--ink-link", { light: 5.2, dark: 7.9 }],
      ["--ink-alert", { light: 5.9, dark: 7.2 }],
    ])("%s clears 4.5:1", (name, quoted) => {
      const measured = worstGround(name, theme);
      expect(measured).toBeGreaterThanOrEqual(4.5);
      expect(measured).toBeGreaterThanOrEqual(quoted[theme]);
      expect(measured).toBeLessThan(quoted[theme] + 0.3);
    });

    it("has no fifth ink role, because there is no room for one", () => {
      // The step under `--ink-muted` measures 3.6:1 at best — and, pleasingly,
      // in *both* directions: `--color-neutral-600` is as unreadable on the
      // dark grounds as on the light ones, because it sits in the middle of
      // the ramp. That is also exactly why `--line-control` can be that step
      // in both themes and clear 3:1 in each.
      expect(worstGround("--color-neutral-600", theme)).toBeLessThan(4.5);
    });

    it("keeps ink opaque, so each role has one contrast figure", () => {
      for (const name of [
        "--ink",
        "--ink-muted",
        "--ink-link",
        "--ink-alert",
      ]) {
        expect(token(name, theme).a).toBe(1);
      }
    });
  });

  describe("fills that carry a label", () => {
    it.each([
      ["--fill-accent", { light: 5.7, dark: 8.9 }],
      ["--fill-accent-hover", { light: 8.8, dark: 12.0 }],
      ["--fill-accent-active", { light: 12.4, dark: 14.3 }],
    ])("%s clears 4.5:1 against --ink-inverse", (fill, quoted) => {
      const measured = contrast(
        token("--ink-inverse", theme),
        token(fill, theme),
      );
      expect(measured).toBeGreaterThanOrEqual(4.5);
      expect(measured).toBeGreaterThanOrEqual(quoted[theme]);
    });

    it("keeps the notification badge legible on the second brand hue", () => {
      expect(
        contrast(
          token("--ink-inverse", theme),
          token("--color-accent-2", theme),
        ),
      ).toBeGreaterThanOrEqual(4.5);
    });

    it("keeps a highlighted panel legible under both inks", () => {
      // `.day-today` and the masthead initials. The panel is tinted, so the
      // ink on it is measured against the tint rather than against a ground.
      for (const ink of ["--ink", "--ink-link"]) {
        expect(
          contrast(token(ink, theme), token("--fill-highlight", theme)),
        ).toBeGreaterThanOrEqual(4.5);
      }
    });
  });

  describe("non-text indicators", () => {
    // 1.4.11 Non-text Contrast, AA: 3:1 against what is adjacent.
    it("draws a control's edge against the control's own fill", () => {
      // The bar is real rather than theoretical: the input fill sits within
      // 1.2:1 of the page in either theme, so nothing but the border says
      // where the control is.
      expect(
        contrast(
          token("--line-control", theme),
          token("--color-surface", theme),
        ),
      ).toBeGreaterThanOrEqual(3);
    });

    it("draws the focus ring on every ground", () => {
      for (const ground of GROUNDS) {
        expect(
          contrast(token("--color-accent", theme), token(ground, theme)),
        ).toBeGreaterThanOrEqual(3);
      }
    });

    it("exempts rules between rows, which carry nothing", () => {
      // Stated so the exemption is a decision rather than an oversight: a
      // table rule is decoration, and 1.4.11 does not reach it.
      expect(
        contrast(token("--line-rule", theme), token("--color-bg", theme)),
      ).toBeLessThan(3);
    });
  });

  describe("tags draw their own pair", () => {
    it.each([
      ["--tag-accent-fill", "--tag-accent-ink"],
      ["--tag-alert-fill", "--tag-alert-ink"],
      ["--tag-neutral-fill", "--tag-neutral-ink"],
    ])("%s is legible under %s", (fill, ink) => {
      expect(
        contrast(token(ink, theme), token(fill, theme)),
      ).toBeGreaterThanOrEqual(4.5);
    });
  });
});

describe("the brand teal is a non-text role in both themes", () => {
  it("misses the text bar as a label on a fill", () => {
    // The reason `--fill-accent` exists at all. `.btn-primary` was the brand
    // teal with a near-white label on it: the most-pressed control in the
    // application, at 3.7:1.
    expect(
      contrast(
        token("--ink-inverse", "light"),
        token("--color-accent", "light"),
      ),
    ).toBeLessThan(4.5);
  });
});

// ── 2. rules read roles ───────────────────────────────────────────────────

describe("every colour in the sheets comes from a role", () => {
  const INK_ROLES = [
    "--ink",
    "--ink-muted",
    "--ink-link",
    "--ink-alert",
    "--ink-inverse",
    // A tag draws its own ground, so its foreground is a half of a pair
    // rather than an ink for a page. Measured against its own fill above.
    "--tag-accent-ink",
    "--tag-alert-ink",
    "--tag-neutral-ink",
  ];

  /**
   * Roles that may be painted as a fill or drawn as an edge.
   *
   * This half of the rule did not exist until dark mode, and there was no way
   * to have it: three grounds and every tag were naming ramp steps directly,
   * which is fine while there is one palette and impossible the moment there
   * are two — a ramp step's value is fixed, and a tag has to be dark-on-light
   * in one theme and light-on-dark in the other. Turning them into roles is
   * what let `background:` and `border-color:` be held to the same rule
   * `color:` had been under since the layer was written.
   */
  const SURFACE_ROLES = [
    "--color-bg",
    "--color-surface",
    "--color-inset",
    "--color-accent",
    "--color-accent-2",
    "--fill-accent",
    "--fill-accent-hover",
    "--fill-accent-active",
    "--fill-highlight",
    "--fill-inert",
    "--line-control",
    "--line-control-hover",
    "--line-divider",
    "--line-rule",
    "--line-soft",
    "--tag-accent-fill",
    "--tag-alert-fill",
    "--tag-neutral-fill",
    "--wash-ink-faint",
    "--wash-ink",
    "--wash-ink-strong",
    "--wash-accent",
    "--wash-accent-strong",
    "--wash-alert",
    "--wash-selection",
    "--wash-scrim",
    // Ink is legitimately a fill: the masthead's 2px rule under it is the
    // heaviest line in the design and is drawn in the body colour.
    "--ink",
    "--ink-muted",
    "--ink-link",
    "--ink-alert",
    "--ink-inverse",
  ];

  /** Every rule body in the two sheets, as `property: value` pairs. */
  function declarations(): ReadonlyArray<readonly [string, string, string]> {
    const found: Array<readonly [string, string, string]> = [];
    for (const [file, css] of [
      ["broadsheet.css", broadsheet],
      ["globals.css", globals],
    ] as const) {
      let inRoot = false;
      for (const line of stripComments(css).split("\n")) {
        if (/^:root/.test(line)) inRoot = true;
        else if (inRoot && line === "}") inRoot = false;
        if (inRoot) continue;
        const decl = /^\s+([a-z-]+):\s*(.+);$/.exec(line);
        if (decl?.[1] !== undefined && decl[2] !== undefined)
          found.push([file, decl[1], decl[2]]);
      }
    }
    return found;
  }

  it("names an ink role in every `color:` declaration", () => {
    const offenders = declarations()
      .filter(([, property]) => property === "color")
      .filter(([, , value]) => value !== "inherit")
      .filter(([, , value]) => !INK_ROLES.some((r) => value === `var(${r})`))
      .map(([file, , value]) => `${file}: ${value}`);

    expect(offenders).toEqual([]);
  });

  it("names a role in every fill and every edge", () => {
    // A ramp step painted straight onto an element is a value with nothing
    // asserted about it *and* no way to answer for a second theme.
    const paints =
      /^(background|background-color|border-color|border-bottom-color|border-top-color|outline-color)$/;
    const offenders = declarations()
      .filter(([, property]) => paints.test(property))
      .filter(([, , value]) => value !== "transparent" && value !== "inherit")
      .filter(
        ([, , value]) => !SURFACE_ROLES.some((r) => value === `var(${r})`),
      )
      .map(([file, property, value]) => `${file}: ${property}: ${value}`);

    expect(offenders).toEqual([]);
  });
});

// ── 3. nothing reaches for a name that does not exist ─────────────────────

describe("every name the markup reaches for resolves", () => {
  /**
   * Published by `next/font` onto the <html> element rather than by a
   * stylesheet, so it is legitimately absent from `:root`.
   */
  const EXTERNAL = new Set(["--font-source-serif"]);

  /** Tests are skipped: this one quotes the dangling names it was written for. */
  function sources(from: string): readonly string[] {
    return readdirSync(join(process.cwd(), from), {
      withFileTypes: true,
    }).flatMap((entry) => {
      const path = `${from}/${entry.name}`;
      if (entry.isDirectory()) return sources(path);
      if (entry.name.includes(".test.")) return [];
      return /\.(ts|tsx|css)$/.test(entry.name) ? [path] : [];
    });
  }

  it("finds no dangling var() in src/", () => {
    const dangling = new Set<string>();
    for (const file of sources("src")) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      for (const [, name] of source.matchAll(/var\((--[a-z0-9-]+)/g)) {
        if (name === undefined) continue;
        if (EXTERNAL.has(name) || TOKENS.has(name)) continue;
        dangling.add(`${name} (${file})`);
      }
    }
    expect([...dangling].sort()).toEqual([]);
  });

  /**
   * The same failure in the other namespace, and just as silent: an unknown
   * class is not an error, the element simply has no rules. It had cost four
   * live defects — `.form-error` carried the sign-in refusal and three
   * conflict-screen messages and was never defined anywhere, so "that password
   * is wrong" rendered as ordinary body text; `.btn-sm` left every row-level
   * button full size; `.finding-list` fell back to browser bullets; and
   * `.topbar-search-form` did nothing, so the search box only looked right by
   * accident of the input's own width.
   */
  it("finds no undefined className in src/", () => {
    const defined = new Set<string>();
    for (const css of [broadsheet, globals]) {
      for (const [, name] of stripComments(css).matchAll(
        /\.([a-z][a-z0-9-]*)/g,
      )) {
        if (name !== undefined) defined.add(name);
      }
    }
    const unknown = new Set<string>();
    for (const file of sources("src")) {
      if (!file.endsWith(".tsx")) continue;
      const source = readFileSync(join(process.cwd(), file), "utf8");
      // Only the literal `className="…"` form. A template or a ternary is
      // assembled at runtime and is not decidable here; the classes those
      // build are all literals somewhere else in the same file.
      for (const [, value] of source.matchAll(/className="([^"{]*)"/g)) {
        for (const name of (value ?? "").split(/\s+/).filter(Boolean)) {
          // Phosphor ships its own sheet, under one reserved prefix.
          if (name.startsWith("ph-")) continue;
          if (defined.has(name)) continue;
          unknown.add(`${name} (${file})`);
        }
      }
    }
    expect([...unknown].sort()).toEqual([]);
  });
});
