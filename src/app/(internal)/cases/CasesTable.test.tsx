// @vitest-environment jsdom

import { useRxSet } from "@effect-rx/rx-react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { roleRx } from "@/rx/session";
import {
  renderWithAtoms,
  servedBy,
  servedSlowlyBy,
  unreachable,
} from "../../../../test/browser";
import { CasesTable } from "./CasesTable";

/** Stands in for the masthead's role select, which is the real writer. */
function RoleSwitch() {
  const setRole = useRxSet(roleRx);
  return (
    <button type="button" onClick={() => setRole("Advocate/Lawyer")}>
      Act as an advocate
    </button>
  );
}

/**
 * The caseload table, over the real API.
 *
 * Three paths, because a screen driven by a `Result` has exactly three: the
 * read in flight, the read that failed, and the rows. Each is asserted against
 * the API actually answering (or actually not), rather than against a `Result`
 * constructed by the test — which would assert that the component can render a
 * value, and nothing about whether it ever receives one.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the caseload", () => {
  it("says it is reading before it has anything to show", async () => {
    const api = servedSlowlyBy();

    renderWithAtoms(<CasesTable status="all" />);
    expect(screen.getByText("Reading the caseload…")).toBeDefined();

    api.answer();
    await screen.findByText("Wanjiku Mwangi v. Nairobi Metro SACCO");
    await api.dispose();
  });

  it("renders the matters, with the names the service resolved", async () => {
    const api = servedBy();

    renderWithAtoms(<CasesTable status="all" />);

    await screen.findByText("Wanjiku Mwangi v. Nairobi Metro SACCO");
    expect(screen.getByText("OKL-2026-014")).toBeDefined();
    // Neither the client's name nor the advocate's is on a matter row: both are
    // joined by the service and arrive on the summary.
    expect(screen.getAllByText("Wanjiku Mwangi")).toHaveLength(2);
    expect(screen.getByText("Adv. Sarah Wanjiru")).toBeDefined();
    expect(
      screen.getByText("Chief Magistrate's Court at Milimani"),
    ).toBeDefined();

    await api.dispose();
  });

  /**
   * The filter is a query parameter, not a `filter()` in the browser. This is
   * the assertion that says so: the two matters that are not Closed never
   * arrive, so no amount of client-side filtering could produce this table.
   */
  it("asks the API for one status rather than filtering what came back", async () => {
    const api = servedBy();

    renderWithAtoms(<CasesTable status="Closed" />);

    await screen.findByText("In re Estate of Njeri Kamau");
    expect(
      screen.queryByText("Wanjiku Mwangi v. Nairobi Metro SACCO"),
    ).toBeNull();

    await api.dispose();
  });

  it("explains a server it cannot reach, rather than rendering an empty table", async () => {
    unreachable();

    renderWithAtoms(<CasesTable status="all" />);

    const refusal = await screen.findByRole("alert");
    expect(refusal.textContent).toContain("did not reach the server");
    expect(screen.queryByRole("table")).toBeNull();
  });

  /**
   * The role lives in an atom, so the table answers to it without being passed
   * anything and without the component that changes it knowing the table
   * exists. None of the fixtures are carried by the advocate the prototype
   * signs in as, so scoping to them empties the table — which is the visible
   * consequence of the atom having moved.
   */
  it("re-scopes when the role changes, with no prop and no reload", async () => {
    const api = servedBy();

    renderWithAtoms(
      <>
        <RoleSwitch />
        <CasesTable status="all" />
      </>,
    );
    await screen.findByText("Wanjiku Mwangi v. Nairobi Metro SACCO");

    fireEvent.click(screen.getByRole("button", { name: "Act as an advocate" }));

    await screen.findByText("No matters match this filter.");
    await api.dispose();
  });

  it("shows nothing to match rather than an empty frame", async () => {
    const api = servedBy({ matters: [] });

    renderWithAtoms(<CasesTable status="all" />);

    await waitFor(() => {
      expect(screen.getByText("No matters match this filter.")).toBeDefined();
    });

    await api.dispose();
  });
});
