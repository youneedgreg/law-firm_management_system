import { afterEach, describe, expect, it, vi } from "vitest";
import { IDLE } from "@/lib/action-state";
import { DEMO_ACCOUNTS } from "@/lib/demo";
import { signInAs as action } from "./actions";

/**
 * The one-click switcher, off the demonstration (D-11).
 *
 * `signInAs` mints a session for a named role — including Managing Partner,
 * which may move client money — without a password being typed. On the
 * portfolio deployment that is the whole point and ADR 0013 argues it through.
 * On a firm's installation it would be an unauthenticated endpoint that hands
 * out the firm's most privileged account to whoever posts to it.
 *
 * ## Why this is tested at the action and not at the page
 *
 * Because hiding the buttons is not what stops it. A Server Action is a POST
 * endpoint with a generated id: anything that has seen that id once — a cached
 * bundle, a bookmarked page, a script written by somebody who visited the demo
 * — can post to it, and the endpoint does not know or care whether this
 * deployment currently renders a form pointing at it.
 *
 * So the assertion is not "the panel is absent". It is that the endpoint itself
 * says no, and says no *before* it consults the roster or reads the shared
 * password — which is why `attempt` is mocked and asserted never to have been
 * called. A refusal that happened after `IdentityService` was asked would be a
 * different, weaker guarantee.
 */

const attempt = vi.hoisted(() => vi.fn());

vi.mock("@/runtime", () => ({ attempt }));

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
  headers: vi.fn(async () => new Headers()),
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

const signInAs = (account: string) => {
  const form = new FormData();
  form.set("account", account);

  return action(IDLE, form);
};

afterEach(() => {
  withEnvironment(undefined);
  vi.clearAllMocks();
});

describe("one-click sign-in, off the demonstration", () => {
  /**
   * Every role on the roster, not a representative one. The account this
   * matters most for is the Managing Partner — the only role that can do
   * everything — and a test that happened to pick the receptionist would pass
   * while the interesting door stood open.
   */
  it.each(DEMO_ACCOUNTS.map((account) => account.key))(
    "refuses %s without reaching the identity service",
    async (key) => {
      withEnvironment(undefined);

      const state = await signInAs(key);

      expect(state.status).toBe("refused");
      expect(attempt).not.toHaveBeenCalled();
    },
  );

  it("refuses when the deployment says it is not a demo", async () => {
    withEnvironment("false");

    const state = await signInAs("managing-partner");

    expect(state.status).toBe("refused");
    expect(attempt).not.toHaveBeenCalled();
  });

  /**
   * The refusal is the same for a key that exists and one that does not.
   *
   * Off the demonstration there is no roster to be on, so "that is not one of
   * the seeded roles" would be answering a different question — and answering
   * it differently for a real key would confirm which keys are real to whoever
   * was guessing.
   */
  it("says nothing about which keys exist", async () => {
    withEnvironment(undefined);

    const real = await signInAs("managing-partner");
    const invented = await signInAs("system-administrator");

    expect(real.reason).toBe(invented.reason);
  });
});
