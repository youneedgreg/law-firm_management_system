import { chromium, type Page } from "@playwright/test";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "../src/lib/demo";

/**
 * Retakes the screenshots in `README.md`. Run with `npm run docs:screens`
 * against a dev server on port 3000 with a seeded database.
 *
 * ## Why a script rather than a person and a cropping tool
 *
 * The screenshots in this repository went stale twice before this existed, and
 * both times invisibly: Phase 9 changed every ink value in the design system
 * and added a second palette, and the images kept showing the contrast failures
 * that phase existed to fix. A picture of an old build is the one document
 * nothing can check — `tokens.test.ts` cannot see a JPEG — so the next best
 * thing is making it one command to retake them all at the same width, in the
 * same theme, signed in as the same person (ADR 0014).
 *
 * Sign-in goes through the demo switcher rather than the form, which is one
 * more place that button is exercised: if the roster and the seed ever
 * disagree, this fails too.
 *
 * The viewport is 1440×900, which is a laptop rather than the 27-inch monitor a
 * screenshot script would default to. A README image is looked at inside a
 * column about 800px wide, and a 2560px capture of a page laid out for 2560px
 * arrives as unreadable grey.
 */

const BASE = process.env["SCREENSHOT_BASE_URL"] ?? "http://localhost:3000";

/** Deep enough for the interesting part of each page, shallow enough to read. */
const VIEWPORT = { width: 1440, height: 900 };

const signIn = async (page: Page, key: string): Promise<void> => {
  const account = DEMO_ACCOUNTS.find((candidate) => candidate.key === key);
  if (account === undefined) throw new Error(`No demo account "${key}"`);

  await page.goto(`${BASE}/sign-in`);
  await page.locator(`button[value="${key}"]`).click();
  await page.waitForURL(`${BASE}${account.landing}`, { timeout: 60_000 });
};

/**
 * The theme is set through the store the application itself reads, not by
 * stamping the attribute: stamping it produces a page whose `color-scheme` and
 * whose control never agreed, and the native date pickers in the screenshot
 * would come back the wrong colour.
 */
/* Named `applyTheme` rather than `useTheme`: this file is linted with the
   React rules, which read the `use` prefix as a hook and refuse it outside a
   component. */
const applyTheme = async (
  page: Page,
  theme: "light" | "dark",
): Promise<void> => {
  await page.evaluate((value) => {
    window.localStorage.setItem("oklaw.theme.v1", JSON.stringify(value));
  }, theme);
  await page.reload();
};

/**
 * Next's development indicator — the floating circle bottom-left — is in the
 * page but is not part of the application, and a README image with a build
 * overlay in the corner is an image of somebody's laptop. Hidden rather than
 * turned off in `next.config.ts`, because it is genuinely useful when running
 * the app and this is the only place it is in the way.
 */
const HIDE_DEV_OVERLAY = "nextjs-portal { display: none !important; }";

const shoot = async (page: Page, path: string, file: string): Promise<void> => {
  await page.goto(`${BASE}${path}`);
  // The figures on every screen come from Postgres; a capture taken before the
  // read settles is a screenshot of a skeleton.
  await page.waitForLoadState("networkidle");
  await page.addStyleTag({ content: HIDE_DEV_OVERLAY });
  await page.screenshot({
    path: `docs/images/${file}`,
    quality: 82,
    type: "jpeg",
  });
  process.stdout.write(`docs/images/${file}\n`);
};

const main = async (): Promise<void> => {
  const browser = await chromium.launch();

  const staff = await browser.newContext({ viewport: VIEWPORT });
  const page = await staff.newPage();

  await signIn(page, "managing-partner");
  await applyTheme(page, "light");

  await shoot(page, "/dashboard", "dashboard.jpg");
  await shoot(page, "/billing", "billing.jpg");

  /**
   * The first matter in the caseload, whichever it is. Hard-coding a reference
   * would tie the screenshots to a seed that is deliberately re-derivable.
   */
  await page.goto(`${BASE}/cases`);
  await page.waitForLoadState("networkidle");
  const matter = await page
    .locator('a[href^="/cases/"]')
    .first()
    .getAttribute("href");

  if (matter !== null) await shoot(page, matter, "case-detail.jpg");

  await applyTheme(page, "dark");
  await shoot(page, "/reports", "reports-dark.jpg");

  await staff.close();

  const client = await browser.newContext({ viewport: VIEWPORT });
  const portal = await client.newPage();

  await signIn(portal, "client");
  await applyTheme(portal, "light");
  await shoot(portal, "/portal", "client-portal.jpg");

  await client.close();
  await browser.close();

  process.stdout.write(
    `Signed in with the published demo password (${DEMO_PASSWORD}).\n`,
  );
};

void main();
