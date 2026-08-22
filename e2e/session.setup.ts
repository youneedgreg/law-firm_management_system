import { expect, test as setup } from "@playwright/test";
import { DEMO_PASSWORD } from "../src/lib/demo";

/**
 * Signs in once, and writes the cookie every other spec starts from.
 *
 * Sign-in is a critical path in its own right and is covered as one in
 * `sign-in.spec.ts`, which runs in the signed-out project and does not use this
 * state. This exists so the other four specs do not each spend a password hash
 * — deliberately expensive, per Phase 8's throttle — proving something already
 * proven next door.
 *
 * The Managing Partner, because the paths below span modules: opening a matter,
 * recording time against it, raising a fee note from that time and taking a
 * payment touch four permissions, and a role that holds all of them keeps these
 * specs about the *paths* rather than about authorization. Authorization has
 * its own adversarial tests at the service and API boundaries, where a refusal
 * can be asserted precisely.
 */
setup("sign in as the managing partner", async ({ page }) => {
  await page.goto("/sign-in");

  await page.getByLabel("Email address").fill("sarah.wanjiru@oklaw.co.ke");
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(
    page.getByRole("heading", { name: /dashboard/i, level: 1 }),
  ).toBeVisible();

  await page.context().storageState({ path: "e2e/.session.json" });
});
