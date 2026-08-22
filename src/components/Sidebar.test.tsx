// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";

/**
 * The navigation drawer, from the keyboard.
 *
 * Below 900px the sidebar is a panel over the page, and everything a mouse
 * could already do to it — open it, get out of it, come back to the control
 * that opened it — has to be available without one. None of these assertions
 * is about what the drawer looks like; each is about a way out that existed
 * for a pointer and did not exist for a keyboard.
 *
 * The width itself is not asserted, because it is not this component's: the
 * drawer and the static column are the same element under one media query, and
 * `open` is only ever true when the toggle is on screen.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/cases",
}));

afterEach(cleanup);

/** The drawer, plus the masthead control that focus is meant to return to. */
function drawer(open: boolean, onClose = vi.fn()) {
  const toggle = createRef<HTMLButtonElement>();
  const view = render(
    <>
      <button ref={toggle} type="button">
        Navigation
      </button>
      <Sidebar
        role="Managing Partner"
        open={open}
        onClose={onClose}
        returnFocusTo={toggle}
      />
    </>,
  );
  return { toggle, onClose, view };
}

describe("the navigation drawer", () => {
  it("closes on Escape", () => {
    // 2.1.2. Every link inside the drawer navigates, so tabbing off the end is
    // the only other way out — which is a keyboard trap in all but name.
    const { onClose } = drawer(true);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores Escape when it is not open", () => {
    // At desktop width there is no drawer, and Escape belongs to whatever else
    // is listening for it — a dialog, most obviously.
    const { onClose } = drawer(false);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("moves focus into the drawer when it opens", () => {
    const { view, toggle } = drawer(false);

    view.rerender(
      <>
        <button ref={toggle} type="button">
          Navigation
        </button>
        <Sidebar
          role="Managing Partner"
          open
          onClose={vi.fn()}
          returnFocusTo={toggle}
        />
      </>,
    );

    // Otherwise the drawer is on screen and the keyboard is still in the
    // masthead, so the next Tab lands on the search box behind the panel.
    const first = screen.getAllByRole("link")[0];
    expect(document.activeElement).toBe(first);
  });

  it("puts focus back on the toggle when it closes", () => {
    const { view, toggle } = drawer(true);

    view.rerender(
      <>
        <button ref={toggle} type="button">
          Navigation
        </button>
        <Sidebar
          role="Managing Partner"
          open={false}
          onClose={vi.fn()}
          returnFocusTo={toggle}
        />
      </>,
    );

    // 2.4.3. The alternative is focus on a link that has just been hidden,
    // which drops it to the body and restarts Tab from the top of the page.
    expect(document.activeElement).toBe(toggle.current);
  });

  it("does not touch focus on a first render at desktop width", () => {
    // The close half must not fire before the drawer has ever been opened, or
    // every page load would pull focus to a control that is not on screen.
    const before = document.activeElement;

    drawer(false);

    expect(document.activeElement).toBe(before);
  });

  it("names the panel the toggle controls", () => {
    // `aria-controls` on the toggle points at this id; the two have to agree,
    // and nothing else would notice if they stopped.
    drawer(false);

    expect(screen.getByRole("navigation", { name: "Main" }).id).toBe(
      "main-nav",
    );
  });
});
