// @vitest-environment jsdom

import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { asAdvocate } from "../../../../test/fixtures";
import {
  renderWithAtoms,
  servedBy,
  servedSlowlyBy,
  unreachable,
} from "../../../../test/browser";
import { CasesTable } from "./CasesTable";

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
   * An advocate's caseload is *fetched* scoped, not filtered after the fact.
   *
   * Phase 5 held the role in an atom and hid rows in the browser. The id now
   * comes from the session and goes to the service as a query parameter, so
   * this asserts something stronger than "the right rows are shown": the row
   * that belongs to another advocate never arrives. The two are
   * indistinguishable in the DOM, which is why the request is the thing that
   * changed and the assertion is that the other matter is absent from a
   * response the table was given in full for the partner.
   */
  it("fetches only the signed-in advocate's own matters", async () => {
    const api = servedBy({ as: asAdvocate });

    renderWithAtoms(<CasesTable status="all" />, asAdvocate);

    await screen.findByText("Wanjiku Mwangi v. Nairobi Metro SACCO");
    expect(
      screen.queryByText("Zenith Distributors Ltd — supply contract review"),
    ).toBeNull();

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
