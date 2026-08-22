"use client";

import { useRxValue, useRxSet } from "@effect-rx/rx-react";
import { useEffect, useId } from "react";
import type { Theme } from "@/rx/records";
import { themeReadyRx, themeRx } from "@/rx/session";

/**
 * Choosing a palette.
 *
 * The control does almost nothing, and that is the design: the page is painted
 * by `light-dark()` reading `color-scheme`, which follows a `data-theme`
 * attribute set by the inline script in `app/layout.tsx` before the first
 * paint. All this does is hold the choice and keep the attribute in step.
 *
 * ## Three states, and the third one is not "unset"
 *
 * `system` is a choice, not the absence of one — it means *follow the machine*,
 * and it has to be reachable again after somebody has picked a side. In the
 * markup it is the attribute being **absent**, because that is what leaves
 * `color-scheme: light dark` free to resolve against the media query.
 *
 * ## The effect waits for the store, and that is the whole subtlety
 *
 * On the first client render the atom has not read `localStorage` yet, so it
 * reads `system` — the server value, which is what keeps hydration matching.
 * Syncing on that would *remove* the attribute the inline script had just set,
 * repaint the page in the system palette, and put it back a frame later. That
 * flash is exactly what the script exists to prevent, so the sync waits until
 * the store has actually answered.
 *
 * ## Where it lives
 *
 * In the sidebar rather than the masthead: the masthead is the identity
 * cluster and is already tight enough to drop the search below 900px, while
 * the sidebar is present at every width — as a column on a desktop and as the
 * drawer on a phone. One instance, so there is no second copy to fall out of
 * step, which the atom would have made harmless and which is still one thing
 * fewer to reason about.
 */
export function ThemeChoice() {
  const theme = useRxValue(themeRx);
  const ready = useRxValue(themeReadyRx);
  const choose = useRxSet(themeRx);
  const id = useId();

  useEffect(() => {
    if (!ready) return;
    const root = document.documentElement;
    if (theme === "system") delete root.dataset["theme"];
    else root.dataset["theme"] = theme;
  }, [theme, ready]);

  return (
    <div className="theme-choice">
      <label className="sidebar-label" htmlFor={id}>
        Appearance
      </label>
      <span className="select">
        <select
          id={id}
          className="input"
          value={theme}
          onChange={(event) => {
            choose(event.target.value as Theme);
          }}
        >
          <option value="system">Match system</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </span>
    </div>
  );
}
