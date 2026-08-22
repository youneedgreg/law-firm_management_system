// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SegmentSkeleton } from "./Skeleton";

/**
 * What a screen shows while it is still reading.
 *
 * The assertions are all about the heading, because that is the part with a
 * claim in it. A block in the wrong place for a second is a cosmetic fault; a
 * heading naming the wrong screen is a wrong statement about where you are,
 * and it is the failure that a title passed in as a prop invites.
 */

const at = vi.hoisted(() => ({ path: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => at.path,
}));

afterEach(cleanup);

describe("the loading skeleton", () => {
  it("shows the real page title rather than a block", () => {
    at.path = "/billing";

    render(<SegmentSkeleton shape="stats" />);

    // Known before any query runs and unchanged after it, so drawing a grey
    // rectangle here would be pretending not to know it — and then shifting
    // the layout when the real one lands.
    expect(
      screen.getByRole("heading", { level: 1, name: "Billing" }),
    ).toBeDefined();
  });

  it("resolves a record's own route to the section it belongs to", () => {
    at.path = "/cases/9ba1ef00-b0f3-51b7-b29a-b74c4aea7f25";

    render(<SegmentSkeleton shape="detail" />);

    // This is why the title is not a prop. `/cases/{id}` is not in the menu,
    // and `itemForPath` answers for it anyway — so the file that stands in for
    // the matter file does not have to be told what it is standing in for.
    expect(
      screen.getByRole("heading", { level: 1, name: "Cases" }),
    ).toBeDefined();
  });

  it("falls back to a block where a route has no menu entry", () => {
    at.path = "/somewhere-nobody-added-to-the-menu";

    const { container } = render(<SegmentSkeleton />);

    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(container.querySelector(".skeleton-title")).not.toBeNull();
  });

  it("announces the wait once and hides the blocks", () => {
    at.path = "/tasks";

    const { container } = render(<SegmentSkeleton shape="rows" />);

    // A screen reader has nothing to gain from eleven unlabelled rectangles.
    expect(screen.getByRole("status").textContent).toBe("Loading");
    expect(
      container.querySelector(".skeleton")?.closest("[aria-hidden]"),
    ).not.toBeNull();
  });

  it.each([
    ["table", 7],
    ["stats", 15],
    ["rows", 10],
    ["detail", 16],
  ] as const)("draws the %s shape", (shape, blocks) => {
    at.path = "/clients";

    const { container } = render(<SegmentSkeleton shape={shape} />);

    expect(container.querySelectorAll(".skeleton")).toHaveLength(blocks);
  });
});
