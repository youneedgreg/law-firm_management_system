import { expect, test } from "@playwright/test";
import { DEMO_PASSWORD } from "../src/lib/demo";

/**
 * The front door.
 *
 * Runs signed out, so it is the one spec that does not inherit the stored
 * session. Three assertions, and the middle one is the point: a wrong password
 * must come back as a sentence beside the form rather than as a thrown error or
 * a blank page, because that is the behaviour every other refusal in this
 * application shares and the one a person meets first.
 */
test.describe("signing in", () => {
  test("turns an unauthenticated visit away and comes back to it", async ({
    page,
  }) => {
    await page.goto("/cases");

    // `proxy.ts` redirects and remembers where you were going.
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fcases/);

    await page.getByLabel("Email address").fill("sarah.wanjiru@oklaw.co.ke");
    await page.getByLabel("Password").fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    // Not the dashboard — the page originally asked for.
    await expect(page).toHaveURL(/\/cases$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("refuses a wrong password as a sentence beside the form", async ({
    page,
  }) => {
    await page.goto("/sign-in");

    await page.getByLabel("Email address").fill("sarah.wanjiru@oklaw.co.ke");
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("signs out through a form, not a link", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email address").fill("sarah.wanjiru@oklaw.co.ke");
    await page.getByLabel("Password").fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.getByRole("button", { name: "Sign out" }).click();

    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("leaves the public metadata files public", async ({ request }) => {
    /*
      `app/robots.ts` and `app/icon.svg` are served at `/robots.txt` and
      `/icon.svg`, and the proxy's matcher named neither — so the one file that
      tells a crawler what to crawl was answered with a 302 to the sign-in
      page, and the browser asking for the tab icon got one too. Both are
      public by definition; there is nothing behind either to protect.

      A signed-out request, deliberately, because that is the only state in
      which the bug exists.
    */
    const robots = await request.get("/robots.txt");
    expect(robots.status()).toBe(200);
    expect(await robots.text()).toContain("User-Agent");

    const icon = await request.get("/icon.svg");
    expect(icon.status()).toBe(200);
    expect(icon.headers()["content-type"]).toContain("svg");
  });
});
