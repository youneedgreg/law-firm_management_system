import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { layerBoundaries } from "../eslint.boundaries.mjs";

/**
 * The layer diagram in `docs/architecture.md`, checked against the rules the
 * linter is configured from.
 *
 * ## Why this test exists
 *
 * An architecture diagram is the single most likely document in a repository to
 * be a lie, because nothing breaks when it becomes one. The layering here is
 * enforced — `no-restricted-imports`, generated from `eslint.boundaries.mjs` —
 * so the picture of it can be *checked* rather than trusted, and there is no
 * good reason not to.
 *
 * Two directions:
 *
 * - **No arrow may claim a dependency the linter forbids.** A diagram showing
 *   `services --> infra` would describe an architecture this repository refuses
 *   to compile, which is the exact failure mode of a diagram written from
 *   memory.
 * - **No governed directory may be missing.** A layer added to the boundary
 *   table and not to the page is a layer nobody reading the docs knows exists.
 *
 * What it deliberately does *not* check is the reverse — that every real import
 * edge is drawn. `app/` imports eight things and a diagram of every edge in the
 * repository would be a hairball nobody reads. The arrows are a summary; what
 * is guaranteed is that the summary is not false.
 */

interface Boundary {
  readonly name: string;
  readonly files: readonly string[];
  readonly forbidden: readonly string[];
}

const boundaries = layerBoundaries as readonly Boundary[];

const page = await readFile(
  new URL("../docs/architecture.md", import.meta.url),
  "utf8",
);

/**
 * The arrows, as `[source, target]`. Only lines that are exactly an edge —
 * `  app --> services` — so a node declaration carrying a label with an arrow
 * in it cannot be mistaken for one.
 */
const arrows: readonly (readonly [string, string])[] = [
  ...page.matchAll(/^ {2}([a-z]+) --> ([a-z]+)$/gm),
].map((match) => [match[1] ?? "", match[2] ?? ""] as const);

/** Which boundary governs `src/<dir>`, if one does. */
const governing = (directory: string): Boundary | undefined =>
  boundaries.find((boundary) =>
    boundary.files.some((glob) => glob.startsWith(`src/${directory}/`)),
  );

/**
 * The forbidden patterns are written four ways per layer — `@/infra/*`,
 * `@/infra`, `** /infra/**`, `** /infra` — because the rule matches the import
 * string. Any of the four naming the target means the edge is refused.
 */
const forbids = (boundary: Boundary, target: string): boolean =>
  boundary.forbidden.includes(`@/${target}`);

describe("the layer diagram", () => {
  it("draws some arrows at all", () => {
    /**
     * The guard on the guard. Every assertion below is a `for` over `arrows`,
     * so a regex that stopped matching — because somebody reformatted the
     * mermaid block — would turn this whole file green while checking nothing.
     */
    expect(arrows.length).toBeGreaterThan(15);
  });

  it("never claims a dependency the linter forbids", () => {
    for (const [source, target] of arrows) {
      const boundary = governing(source);
      if (boundary === undefined) continue;

      expect(
        forbids(boundary, target),
        `docs/architecture.md draws ${source} --> ${target}, which ` +
          `eslint.boundaries.mjs forbids: ${boundary.name} may not import ${target}`,
      ).toBe(false);
    }
  });

  it("names every directory the boundaries govern", () => {
    const drawn = new Set(arrows.flat());

    for (const boundary of boundaries) {
      for (const glob of boundary.files) {
        const directory = /^src\/([a-z]+)\//.exec(glob)?.[1];
        if (directory === undefined) continue;

        expect(
          drawn.has(directory),
          `src/${directory}/ is governed by the "${boundary.name}" boundary and ` +
            `does not appear in the layer diagram`,
        ).toBe(true);
      }
    }
  });

  /**
   * The other direction of the same worry: a directory that exists under `src/`
   * and is on no diagram and under no rule. `lib/` is deliberately ungoverned —
   * it is a leaf every layer may use — but it is on the diagram, and this is
   * what would notice the day a new one is not.
   */
  it("names every directory under src/", () => {
    const drawn = new Set(arrows.flat());

    return readdir(new URL("../src", import.meta.url), {
      withFileTypes: true,
    }).then((entries) => {
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        expect(
          drawn.has(entry.name),
          `src/${entry.name}/ exists and is not on the layer diagram`,
        ).toBe(true);
      }
    });
  });
});
