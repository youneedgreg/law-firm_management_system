// @vitest-environment jsdom

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  renderWithAtoms,
  servedBy,
  servedSlowlyBy,
} from "../../../../../test/browser";
import { closedMatter, unfiledMatter } from "../../../../../test/fixtures";
import { StatusPanel } from "./StatusPanel";

/**
 * The optimistic move, and the rollback.
 *
 * The interesting assertions are about the interval between the click and the
 * answer, so the API is held open deliberately: a test that awaited the
 * response could not tell an optimistic update from a fast one. `servedSlowlyBy`
 * hands back the trigger, so "before the server answers" and "after the server
 * answers" are two separate points in the test.
 */

vi.mock("next/navigation", () => ({
  // `router.refresh()` re-reads the server-rendered page around the panel.
  // There is no server-rendered page here, so it is a call to observe rather
  // than an effect to have: what matters is that it happens on success and
  // does not happen on a refusal.
  useRouter: () => ({ refresh: refreshed }),
}));

const refreshed = vi.fn();

/**
 * The status tag, as distinct from the button offering to move to it.
 *
 * Both say "Active"; only one of them is a claim about the matter.
 */
const showing = (status: string): HTMLElement =>
  screen.getByText(status, { selector: "span" });

afterEach(() => {
  cleanup();
  refreshed.mockClear();
  vi.unstubAllGlobals();
});

describe("moving a matter", () => {
  it("shows the new status before the server has agreed", async () => {
    const api = servedSlowlyBy();

    renderWithAtoms(
      <StatusPanel
        id={unfiledMatter.id}
        status="New"
        mayBeMovedTo={["Active"]}
      />,
    );

    expect(showing("New")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Active" }));

    // The request has not been answered, and the panel has already moved.
    await screen.findByText("Saving…");
    expect(showing("Active")).toBeDefined();

    api.answer();
    await waitFor(() => expect(screen.queryByText("Saving…")).toBeNull());
    expect(refreshed).toHaveBeenCalled();

    await api.dispose();
  });

  /**
   * The stale-page case, and the only reason optimism needs a way back.
   *
   * The matter is Closed on the server; this panel was rendered when it was
   * not, so it offers a move the lifecycle no longer permits. The guess is
   * shown, the server refuses, and the panel returns to the status on file with
   * the domain's own sentence — which names the move that *was* available, and
   * was composed on the server from the transition table rather than sent as a
   * string.
   */
  it("rolls back to the status on file, with the reason it was refused", async () => {
    const api = servedBy();

    renderWithAtoms(
      <StatusPanel
        id={closedMatter.id}
        status="Closed"
        mayBeMovedTo={["Active"]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Active" }));

    const refusal = await screen.findByRole("alert");
    expect(refusal.textContent).toContain("it may only become Appealed");
    expect(showing("Closed")).toBeDefined();
    expect(refreshed).not.toHaveBeenCalled();

    await api.dispose();
  });

  it("offers nothing where the lifecycle allows nothing", () => {
    const api = servedBy();

    renderWithAtoms(
      <StatusPanel id={closedMatter.id} status="Closed" mayBeMovedTo={[]} />,
    );

    expect(
      screen.getByText("A matter in this state cannot change status."),
    ).toBeDefined();
    expect(screen.queryByRole("button")).toBeNull();

    void api.dispose();
  });
});
