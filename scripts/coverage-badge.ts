import { readFile, writeFile } from "node:fs/promises";

/**
 * Writes `docs/coverage.svg` from the last coverage run.
 * Run with `npm run docs:coverage`, which measures first.
 *
 * ## Why the badge is a file rather than a shields.io URL
 *
 * The usual arrangement points the README at `img.shields.io/…/coverage.svg`,
 * which requires either a coverage service holding the data (an account, a
 * token, and a third party who now knows about this repository) or a
 * hand-typed number in the URL, which is the same lie with extra latency.
 *
 * This draws the badge from `coverage/coverage-summary.json`, so the number is
 * whatever the suite last measured. It is a static file and it can still go
 * stale — but it cannot *overstate*, because `vitest.config.ts` sets coverage
 * thresholds at the floor the badge claims and CI runs `npm run test:coverage`.
 * Coverage falling below the badge fails the build before anybody sees the
 * badge. See ADR 0014.
 *
 * ## Why it is hand-drawn SVG
 *
 * Eleven lines of markup against a dependency that renders eleven lines of
 * markup. The text width is estimated at 6.6px per character, which is close
 * enough for a fixed-width label in the one font stack every badge uses — and
 * the badge is 20 pixels tall, so being two pixels wide of ideal is invisible.
 */

interface Summary {
  readonly total: Record<string, { readonly pct: number }>;
}

/** Green above 90, amber above 75, red below. A badge that is always green is a decoration. */
const colourFor = (pct: number): string =>
  pct >= 90 ? "#2f7d32" : pct >= 75 ? "#a06a00" : "#b3261e";

const width = (text: string): number => Math.round(text.length * 6.6 + 12);

const badge = (label: string, value: string, colour: string): string => {
  const left = width(label);
  const right = width(value);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${String(left + right)}" height="20" role="img" aria-label="${label}: ${value}">
  <title>${label}: ${value}</title>
  <rect width="${String(left)}" height="20" fill="#3b3b3b"/>
  <rect x="${String(left)}" width="${String(right)}" height="20" fill="${colour}"/>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11">
    <text x="${String(left / 2)}" y="14">${label}</text>
    <text x="${String(left + right / 2)}" y="14">${value}</text>
  </g>
</svg>
`;
};

const main = async (): Promise<void> => {
  const summary = JSON.parse(
    await readFile(
      new URL("../coverage/coverage-summary.json", import.meta.url),
      "utf8",
    ),
  ) as Summary;

  /**
   * Lines, not statements or functions. Functions sits lower here for a reason
   * worth not papering over — the repository *interfaces* in `services/` are
   * counted as uncovered functions when a fake implements them — and picking
   * whichever metric flatters the number is how a coverage badge becomes
   * meaningless.
   */
  const pct = summary.total["lines"]?.pct ?? 0;
  const rounded = Math.floor(pct);

  await writeFile(
    new URL("../docs/coverage.svg", import.meta.url),
    badge("coverage", `${String(rounded)}%`, colourFor(rounded)),
    "utf8",
  );

  process.stdout.write(`docs/coverage.svg — ${String(rounded)}% of lines\n`);
};

void main();
