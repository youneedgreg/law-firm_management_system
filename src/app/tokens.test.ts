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

function resolve(value: string, depth = 0): Rgba {
  if (depth > 10) throw new Error(`cyclic token: ${value}`);
  const text = value.trim();

  const ref = /^var\((--[a-z0-9-]+)\)$/.exec(text);
  if (ref?.[1] !== undefined) {
    const next = TOKENS.get(ref[1]);
    if (next === undefined) throw new Error(`undefined token ${ref[1]}`);
    return resolve(next, depth + 1);
  }

  // The only mix form the sheets use, and the only one worth supporting: a
  // colour laid over whatever is behind it at some strength.
  const mix = /^color-mix\(in srgb, (.+?) (\d+)%, transparent\)$/.exec(text);
  if (mix?.[1] !== undefined && mix[2] !== undefined) {
    const base = resolve(mix[1], depth + 1);
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

const token = (name: string): Rgba => resolve(`var(${name})`);

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
const GROUNDS = ["--color-bg", "--color-surface", "--color-neutral-100"];

const worstGround = (name: string) =>
  Math.min(...GROUNDS.map((g) => contrast(token(name), token(g))));

// ── 1. every role clears its bar ──────────────────────────────────────────

describe("ink roles are readable on every ground", () => {
  // 1.4.3 Contrast (Minimum), AA, normal-size text.
  it.each([
    ["--ink", 13.7],
    ["--ink-muted", 5.3],
    ["--ink-link", 5.2],
    ["--ink-alert", 5.9],
  ])("%s clears 4.5:1 (quoted %s:1)", (name, quoted) => {
    const measured = worstGround(name);
    expect(measured).toBeGreaterThanOrEqual(4.5);
    // The figure in the stylesheet's own comment is not allowed to drift from
    // the value beside it.
    expect(measured).toBeGreaterThanOrEqual(quoted);
    expect(measured).toBeLessThan(quoted + 0.2);
  });

  it("has no fifth ink role, because there is no room for one", () => {
    // The step under `--ink-muted` on this ramp measures 3.6:1 at best. It was
    // used as text in six places and is what `--ink-muted` replaced; if a
    // future ramp makes it viable this test is the place to notice.
    expect(worstGround("--color-neutral-600")).toBeLessThan(4.5);
  });

  it("keeps ink opaque, so each role has one contrast figure", () => {
    for (const name of ["--ink", "--ink-muted", "--ink-link", "--ink-alert"]) {
      expect(token(name).a).toBe(1);
    }
  });
});

describe("fills that carry a label", () => {
  it.each([
    ["--fill-accent", 5.7],
    ["--fill-accent-hover", 8.8],
    ["--fill-accent-active", 12.4],
  ])("%s clears 4.5:1 against --ink-inverse", (fill, quoted) => {
    const measured = contrast(token("--ink-inverse"), token(fill));
    expect(measured).toBeGreaterThanOrEqual(4.5);
    expect(measured).toBeGreaterThanOrEqual(quoted);
  });

  it("is a darker step than the brand teal, which misses the bar", () => {
    // The reason `--fill-accent` exists at all. `.btn-primary` was the brand
    // teal with a `--color-bg` label on it: the most-pressed control in the
    // application, at 3.7:1.
    expect(
      contrast(token("--ink-inverse"), token("--color-accent")),
    ).toBeLessThan(4.5);
  });

  it("keeps the notification badge legible on the second brand hue", () => {
    // Left as `--color-accent-2` rather than darkened by reflex: it measures
    // 4.6:1, and the next step down its ramp is *worse* at 4.3:1.
    expect(
      contrast(token("--ink-inverse"), token("--color-accent-2")),
    ).toBeGreaterThanOrEqual(4.5);
  });
});

describe("non-text indicators", () => {
  // 1.4.11 Non-text Contrast, AA: 3:1 against what is adjacent.
  it("draws a control's edge against the control's own fill", () => {
    // The bar is real rather than theoretical here: the input fill sits within
    // 1.1:1 of the page, so nothing but the border says where the control is.
    expect(
      contrast(token("--line-control"), token("--color-surface")),
    ).toBeGreaterThanOrEqual(3);
  });

  it("draws the focus ring on every ground", () => {
    for (const ground of GROUNDS) {
      expect(
        contrast(token("--color-accent"), token(ground)),
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("exempts rules between rows, which carry nothing", () => {
    // Stated so the exemption is a decision rather than an oversight: a table
    // rule is decoration, and 1.4.11 does not reach it.
    expect(contrast(token("--line-rule"), token("--color-bg"))).toBeLessThan(3);
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
  ];

  /**
   * Rules whose ground is not one of `GROUNDS`, so they are measured here
   * against the fill they actually sit on instead. Each is a self-contained
   * pair: a tag draws its own background, so the page behind it is irrelevant.
   */
  const OWN_GROUND: ReadonlyArray<readonly [string, string, string]> = [
    [".tag-accent", "--color-accent-800", "--color-accent-100"],
    [".tag-accent-2", "--color-accent-2-800", "--color-accent-2-100"],
    [".tag-neutral", "--color-neutral-800", "--color-neutral-100"],
  ];

  it("names an ink role in every `color:` declaration", () => {
    const exempt = new Set(OWN_GROUND.map(([, fg]) => `var(${fg})`));
    const offenders: string[] = [];
    for (const [file, css] of [
      ["broadsheet.css", broadsheet],
      ["globals.css", globals],
    ] as const) {
      for (const line of stripComments(css).split("\n")) {
        const decl = /^\s+color:\s*(.+);$/.exec(line);
        const value = decl?.[1];
        if (value === undefined) continue;
        if (value === "inherit") continue;
        if (exempt.has(value)) continue;
        if (!INK_ROLES.some((role) => value === `var(${role})`))
          offenders.push(`${file}: ${value}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it.each(OWN_GROUND)("%s is legible on the fill it draws", (_, fg, bg) => {
    expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
  });
});

// ── 3. nothing reaches for a token that does not exist ────────────────────

describe("every token referenced anywhere resolves", () => {
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
});
