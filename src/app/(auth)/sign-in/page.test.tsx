// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { Option } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_PASSWORD } from "@/lib/demo";
import SignInPage from "./page";

/**
 * What a firm's staff see on the way in (D-11).
 *
 * The security property — that `signInAs` refuses whatever this page renders —
 * is asserted next door in `actions.test.ts`, and it is the one that matters.
 * This is about the other half: a solicitor signing in to their own practice
 * management system should not be reading a paragraph offering them a shared
 * password and six fictional colleagues to impersonate.
 *
 * It is checked by rendering rather than by reading the source for a
 * conditional, because the failure this guards against is a `&&` that stays
 * true — a panel restored during a refactor, a password moved into a component
 * that forgot to ask. The question is what reaches the page, so the test looks
 * at the page.
 */

vi.mock("@/runtime/session", () => ({
  principal: vi.fn(async () => Option.none()),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("redirect was reached, and should not have been");
  }),
}));

const withEnvironment = (value: string | undefined) => {
  if (value === undefined) delete process.env["DEMO_DEPLOYMENT"];
  else process.env["DEMO_DEPLOYMENT"] = value;
};

/**
 * The page is an async Server Component, so it is awaited into an element and
 * then rendered — there is no request here, and it does not need one: what it
 * puts on the screen depends on the environment and on nothing else about how
 * it was reached.
 */
const signInPage = async () => {
  render(
    await SignInPage({
      params: Promise.resolve({}),
      searchParams: Promise.resolve({}),
    } as never),
  );
};

afterEach(() => {
  withEnvironment(undefined);
});

describe("the sign-in page", () => {
  it("is the form and nothing else on a firm's installation", async () => {
    withEnvironment(undefined);
    await signInPage();

    expect(screen.getByLabelText(/email/i)).toBeTruthy();
    expect(screen.queryByText(/demo accounts/i)).toBeNull();
    expect(screen.queryByText(DEMO_PASSWORD)).toBeNull();
  });

  /**
   * Each role by name. The panel is one `&&`, so a test that only looked for
   * the heading would pass if the buttons escaped the conditional on their own
   * — which is exactly what a careless refactor does.
   */
  it("offers nobody to impersonate", async () => {
    withEnvironment(undefined);
    await signInPage();

    for (const role of [
      /managing partner/i,
      /advocate/i,
      /legal assistant/i,
      /finance officer/i,
      /receptionist/i,
      /client portal/i,
    ]) {
      expect(screen.queryByRole("button", { name: role })).toBeNull();
    }
  });

  /**
   * The other direction, so that this pair cannot both pass by the panel having
   * been deleted outright. The demonstration is a deliberate thing that has to
   * keep working; ADR 0013 is the argument for it.
   */
  it("still carries the roster on the demonstration", async () => {
    withEnvironment("true");
    await signInPage();

    expect(screen.getByText(/demo accounts/i)).toBeTruthy();
    expect(screen.getByText(DEMO_PASSWORD)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /managing partner/i }),
    ).toBeTruthy();
  });
});
