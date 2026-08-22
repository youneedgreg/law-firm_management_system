import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

/**
 * axe, against a laid-out page.
 *
 * The accessibility work earlier in this phase deliberately did not add axe to
 * the unit suite: in jsdom it cannot check contrast, which `tokens.test.ts`
 * already checks better — from the stylesheet, in both themes, with a figure
 * per role — and most of what remains needs geometry to find. Here there is a
 * real browser, real layout and real computed styles, so it can.
 *
 * ## What it is and is not
 *
 * An automated pass catches perhaps a third of what matters, and it catches the
 * mechanical third: an unlabelled control, a broken `aria-*` reference, a
 * heading level skipped, contrast on a real background. It cannot tell whether
 * focus goes somewhere sensible or whether a refusal explains itself — those
 * are asserted where they are decided, in `Sidebar.test.tsx` and in the service
 * tests. This is the net under the work, not the work.
 *
 * ## Both themes, because half the rules are about colour
 *
 * A palette that passes in light says nothing about the other one, and the
 * whole point of having measured both is that neither is assumed. The theme is
 * set the way the application sets it — the attribute the inline script writes
 * — rather than by emulating a media query, so what is tested is the state a
 * person who chose dark is actually in.
 */

/**
 * One of each *kind* of screen rather than all twenty-six.
 *
 * A list page, a record's own file, a page of figures, a diary and a screen
 * with a chart on it. They are built from the same components, so a twenty-sixth
 * of the same shape would report the same thing more slowly; what earns a place
 * is a layout the others do not have.
 */
const SCREENS: ReadonlyArray<{
  readonly name: string;
  readonly open: (page: Page) => Promise<void>;
}> = [
  { name: "the caseload", open: (page) => page.goto("/cases").then(() => {}) },
  {
    name: "a matter file",
    open: async (page) => {
      await page.goto("/cases");
      await page.getByRole("link", { name: "Open" }).first().click();
      await expect(page).toHaveURL(/\/cases\/[0-9a-f-]{36}$/);
    },
  },
  { name: "billing", open: (page) => page.goto("/billing").then(() => {}) },
  {
    name: "the court diary",
    open: (page) => page.goto("/calendar").then(() => {}),
  },
  { name: "the timesheet", open: (page) => page.goto("/time").then(() => {}) },
  { name: "reports", open: (page) => page.goto("/reports").then(() => {}) },
];

const THEMES = ["light", "dark"] as const;

for (const theme of THEMES) {
  test.describe(`${theme} theme`, () => {
    for (const screen of SCREENS) {
      test(`${screen.name} has no automatically detectable violations`, async ({
        page,
      }) => {
        await screen.open(page);
        await page.evaluate((choice: string) => {
          document.documentElement.dataset["theme"] = choice;
        }, theme);

        // The caseload's rows arrive from an atom, so the table is not there on
        // first paint. Waiting for a heading would pass over an empty page;
        // waiting for the thing under test is what makes the run meaningful.
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

        const { violations } = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
          .analyze();

        expect(
          violations.map((v) => `${v.id}: ${v.nodes.length} × ${v.help}`),
        ).toEqual([]);
      });
    }
  });
}
