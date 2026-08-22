import { expect, type Page, test } from "@playwright/test";
import { MARK } from "./sweep";

/**
 * The path the firm is actually for, end to end.
 *
 * A matter is opened, an advocate records the hours they worked on it, those
 * hours become a fee note, and the client pays it. Every layer participates:
 * a Server Action decodes the form through the same schema that gave the input
 * its constraints, `CaseService` derives the next matter reference from what is
 * stored, `TimeService.raiseFromTime` claims the entries in one `UPDATE` and
 * fails the transaction if it did not get all of them, and `BillingService`
 * appends the payment rather than replacing the invoice's list.
 *
 * ## One test, not four
 *
 * Each step needs what the one before it produced — you cannot bill hours you
 * have not recorded — so splitting them would mean either four tests that each
 * rebuild the state, or four that depend on execution order, which is a
 * different way of writing one test while pretending otherwise. The steps are
 * `test.step`s, so a failure still names which one broke.
 *
 * ## Everything it creates is marked
 *
 * The matter's title begins with `E2E`, and `sweep.ts` deletes by that before
 * and after every run. The fee note and the time entries follow the matter —
 * the invoice explicitly, because `invoices.case_id` is `SET NULL` rather than
 * cascade, since a fee note outlives the file it was raised against.
 */

/** Distinct per run, so a spec never sees a previous run's leftovers. */
const title = `${MARK} ${Date.now().toString(36)} — Wanjiku Mwangi v. Rift Valley`;

/** `yyyy-mm-dd` for a date input, from a real clock. */
const day = (offset = 0): string => {
  const at = new Date();
  at.setDate(at.getDate() + offset);
  return at.toISOString().slice(0, 10);
};

/**
 * The matter's row in the work-in-progress list.
 *
 * Named by what it *offers* rather than by where it sits, because the
 * timesheet below it names the same matter and a locator keyed on the
 * reference alone matches both. Recorded hours and unbilled hours are two
 * different claims about the same work, and only one of them can be billed.
 */
const workInProgress = (page: Page, matterNumber: string) =>
  page
    .getByRole("row")
    .filter({ hasText: matterNumber })
    .filter({ has: page.getByRole("button", { name: "Bill" }) });

/** Opens a dialog and waits for it to actually be there before typing. */
async function dialog(page: Page, trigger: string) {
  await page.getByRole("button", { name: trigger, exact: true }).click();
  const open = page.getByRole("dialog");
  await expect(open).toBeVisible();
  return open;
}

test("a matter is opened, worked, billed and paid", async ({ page }) => {
  let matterNumber = "";

  await test.step("open the matter", async () => {
    await page.goto("/cases");
    const form = await dialog(page, "New case");

    await form.getByLabel("Case title").fill(title);
    await form.getByLabel("Client").selectOption({ label: "Wanjiku Mwangi" });
    await form.getByLabel("Matter type").selectOption("Civil");
    await form
      .getByLabel("Assigned advocate")
      .selectOption({ label: "Adv. Sarah Wanjiru — Managing Partner" });
    await form.getByLabel("File opened").fill(day());
    await form.getByRole("button", { name: "Open case" }).click();

    // Opening a matter redirects to its file, so the reference the service
    // derived is on the page rather than guessed at here.
    await expect(page).toHaveURL(/\/cases\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();

    const eyebrow = await page.locator(".eyebrow").first().innerText();
    const found = /OKL-\d{4}-\d+/.exec(eyebrow);
    expect(found, `no matter reference in "${eyebrow}"`).not.toBeNull();
    matterNumber = found?.[0] ?? "";
  });

  await test.step("record time against it", async () => {
    await page.goto("/time");
    const form = await dialog(page, "Record time");

    // The option is built as `${number} — ${title}` in `LogTimeForm`, so the
    // reference the service derived a moment ago is enough to name it exactly.
    await form
      .getByLabel("Matter")
      .selectOption({ label: `${matterNumber} — ${title}` });
    await form.getByLabel("Activity").selectOption("Drafting");
    await form.getByLabel("Date").fill(day());
    await form.getByLabel("Start").fill("09:00");
    await form.getByLabel("End").fill("11:30");
    await form.getByLabel("Rate (KES/hour)").fill("20000");
    await form
      .getByLabel("Narrative")
      .fill("Drafting the plaint and the verifying affidavit.");
    await form.getByRole("button", { name: "Record" }).click();

    await expect(page.getByRole("dialog")).toBeHidden();

    // Two and a half hours at 20,000 is 50,000 of unbilled work, and the
    // matter is now on the work-in-progress list because of it.
    await expect(workInProgress(page, matterNumber)).toContainText("2.5");
    await expect(workInProgress(page, matterNumber)).toContainText("50,000");
  });

  await test.step("turn the hours into a fee note", async () => {
    await workInProgress(page, matterNumber)
      .getByRole("button", { name: "Bill" })
      .click();
    const form = page.getByRole("dialog");
    await expect(form).toBeVisible();
    await form.getByRole("button", { name: "Raise fee note" }).click();

    await expect(page.getByRole("dialog")).toBeHidden();
    // The matter leaves work in progress: its hours are on a fee note now, and
    // `raiseFromTime` marked them so they cannot be billed twice. The timesheet
    // row above stays — the work still happened — which is why the locator has
    // to be the one that offers to bill rather than any row naming the matter.
    await expect(workInProgress(page, matterNumber)).toHaveCount(0);
  });

  await test.step("take a payment against it", async () => {
    await page.goto("/billing");

    // The newest fee note is the one just raised; find it by its outstanding
    // amount rather than by position, which a seeded row could take.
    const row = page.getByRole("row", { name: /Ksh 50,000\.00/ }).first();
    await row.getByRole("link", { name: "Open" }).click();

    await expect(page.getByText("Ksh 50,000.00").first()).toBeVisible();

    const form = await dialog(page, "Record payment");
    await form.getByLabel("Amount (KES)").fill("50000");
    await form.getByLabel("Received").fill(day());
    await form.getByLabel("Method").selectOption("Bank Transfer");
    await form.getByRole("button", { name: "Record payment" }).click();

    await expect(page.getByRole("dialog")).toBeHidden();
    // Status is derived from lines and payments rather than stored, so a fee
    // note paid in full says so without anything having set a field.
    await expect(page.getByText("Paid", { exact: true })).toBeVisible();
  });
});
