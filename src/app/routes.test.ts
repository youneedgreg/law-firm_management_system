import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every screen that waits, says so.
 *
 * Next renders `loading.tsx` the instant a navigation begins and keeps the
 * shell in place, so the cost of not having one is invisible in development
 * and obvious in production: a link click does nothing at all until the server
 * answers, and against a Neon instance that has scaled to zero that is the
 * better part of two seconds with the previous page still on screen.
 *
 * Invisible in development is the reason this is a test rather than a habit.
 * A new route added on a warm connection looks fine to whoever added it, and
 * the person who finds out is a stranger on a cold one.
 *
 * The boundary may be the page's own directory or any ancestor, because that
 * is how Next resolves it — a `loading.tsx` covers its whole subtree.
 */

const APP = join(process.cwd(), "src/app");

function pages(from: string): readonly string[] {
  return readdirSync(from, { withFileTypes: true }).flatMap((entry) => {
    const path = join(from, entry.name);
    if (entry.isDirectory()) return pages(path);
    return entry.name === "page.tsx" ? [path] : [];
  });
}

/** Whether the page reaches the database at all. */
const reads = (page: string) =>
  /from "@\/runtime/.test(readFileSync(page, "utf8"));

/** Walks up to `src/app`, the way Next resolves the nearest boundary. */
function hasLoadingBoundary(page: string): boolean {
  let dir = dirname(page);
  for (;;) {
    if (existsSync(join(dir, "loading.tsx"))) return true;
    if (dir === APP) return false;
    dir = dirname(dir);
  }
}

/**
 * Routes that reach the runtime and still need no loading state, with the
 * reason. Both are here because they never render a result.
 */
const NO_WAIT_TO_SHOW: Readonly<Record<string, string>> = {
  "(auth)/sign-in":
    "A form. The read is the session check that decides whether to redirect, and it happens before anything is drawn.",
  "(internal)/calendar/[id]":
    "Redirects to the matter. A skeleton would be drawn for a page that is on its way somewhere else.",
};

const routeOf = (page: string) =>
  dirname(page)
    .slice(APP.length + 1)
    .replaceAll("\\", "/");

describe("loading boundaries", () => {
  const waiting = pages(APP).filter(reads);

  it("covers every route that reads, or names why not", () => {
    const uncovered = waiting
      .filter((page) => !hasLoadingBoundary(page))
      .map(routeOf)
      .filter((route) => !(route in NO_WAIT_TO_SHOW))
      .sort();

    expect(uncovered).toEqual([]);
  });

  it("has no loading state for a route that never waits", () => {
    // The other half, and the reason `cases/loading.tsx` was deleted: the
    // caseload's rows are an atom, so that page renders immediately and the
    // table reports its own progress. A `loading.tsx` on the parent covers the
    // whole subtree, so the one that used to sit there was answering for the
    // matter file under the wrong name — which is why the matter file now has
    // its own.
    const idle = pages(APP)
      .filter((page) => !reads(page))
      .filter((page) => existsSync(join(dirname(page), "loading.tsx")))
      .map(routeOf)
      .sort();

    expect(idle).toEqual([]);
  });

  it("does not exempt a route that has since gained a boundary", () => {
    // An exemption nobody revisits is a comment. If one of these grows a
    // `loading.tsx`, the entry above it is stale and should go.
    const stale = Object.keys(NO_WAIT_TO_SHOW).filter((route) =>
      existsSync(join(APP, route, "loading.tsx")),
    );

    expect(stale).toEqual([]);
  });
});
