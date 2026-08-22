import { expect, test } from "@playwright/test";

/**
 * The screens at the width most people would actually open them.
 *
 * The prototype this grew from was desktop-first and expressed its layout as
 * inline styles switched by a JS `isMobile` flag; that became real media
 * queries early on, and the media queries were never checked at a real width
 * by anything but a person resizing a window. Two defects had accumulated
 * behind that, and neither was subtle once a browser was pointed at 390px.
 *
 * ## The assertion is about the *content pane*, not the page
 *
 * `document.scrollWidth` was already correct on every screen — and said
 * nothing, because `.content` has `overflow-y: auto`, which makes it a scroll
 * container on both axes. Anything too wide scrolled sideways *inside* it
 * while the page reported itself as fitting. That is why the stat figures had
 * been clipped for as long as they had: nothing that measured the page could
 * see it.
 *
 * A table is allowed to be wider than the phone. `.table-wrap` gives it its own
 * scroll box, which is a considered answer to a nine-column table on a 390px
 * screen and not a failure to fit — and because the box is bounded, it does not
 * make the pane scroll either.
 */

const PHONE = { width: 390, height: 844 };

const SCREENS = [
  "/dashboard",
  "/cases",
  "/billing",
  "/calendar",
  "/time",
  "/reports",
  "/clients",
  "/tasks",
  "/documents",
] as const;

test.use({ viewport: PHONE });

test.describe("on a phone", () => {
  for (const path of SCREENS) {
    test(`${path} fits without scrolling sideways`, async ({ page }) => {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { level: 1 }).first(),
      ).toBeVisible();

      const overflow = await page.evaluate(() => {
        const pane = document.querySelector(".content");
        if (pane === null) throw new Error("no content pane");
        return {
          page: document.documentElement.scrollWidth - window.innerWidth,
          pane: pane.scrollWidth - pane.clientWidth,
        };
      });

      expect(overflow.page).toBeLessThanOrEqual(0);
      expect(overflow.pane).toBeLessThanOrEqual(0);
    });
  }

  test("the masthead stays inside the masthead", async ({ page }) => {
    await page.goto("/dashboard");

    /*
      What the defect actually was, after two wrong measurements of it.
      
      It looked like elements overlapping and was not — flex items do not
      overlap. It looked like text spilling its box, and `scrollWidth >
      clientWidth` did not find it either, because the item it happened to is
      the brand, which is an inline `<a>`: both properties are defined as zero
      for an inline box, so the measurement returned nothing and said so
      confidently.

      What is true is simpler. The items were laid out at their desktop sizes,
      the row ran past 390px, and `.shell` has `overflow: hidden`, so the far
      end was clipped rather than scrolled — which is why nothing about the
      page's or the pane's width could see it either. So: every item's painted
      box has to finish inside the bar that contains it.
    */
    const escaping = await page.locator(".topbar > *").evaluateAll((items) => {
      const bar = document.querySelector(".topbar");
      if (bar === null) throw new Error("no masthead");
      const edge = bar.getBoundingClientRect().right;
      return items
        .map((el) => ({ el, box: el.getBoundingClientRect() }))
        .filter(({ box }) => box.width > 0 && box.right > edge + 1)
        .map(
          ({ el, box }) =>
            `${el.className || el.tagName} reaches ${String(Math.round(box.right))}px of ${String(Math.round(edge))}px`,
        );
    });

    expect(escaping).toEqual([]);
  });

  test("the navigation is reachable through the drawer", async ({ page }) => {
    await page.goto("/dashboard");

    // The column is a drawer at this width, so the only way to the other
    // screens is the toggle — which makes it the single point of failure for
    // the whole application on a phone.
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav).toBeHidden();

    await page.getByRole("button", { name: "Navigation" }).click();
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("link", { name: "Billing" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(nav).toBeHidden();
  });
});
