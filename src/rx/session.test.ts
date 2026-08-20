// @vitest-environment jsdom

import { Registry, Rx } from "@effect-rx/rx-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "./records";
import {
  hydratedRx,
  invoiceOverridesRx,
  recordsRx,
  settingsRx,
} from "./session";

/**
 * The session atoms, against the browser's own store.
 *
 * No React here. These are assertions about the atoms — what they read, what
 * they write, and what they do with a stored value they cannot make sense of —
 * and a component around them would only be scenery. The screens that read them
 * are covered where they live.
 *
 * A `Registry` per test is the isolation: the atoms are module-level values,
 * but their state is per registry, so nothing leaks between tests except
 * `localStorage`, which is cleared.
 */

/**
 * The persisted atom these tests drive.
 *
 * It was the role until Phase 6, which is where the role stopped being a value
 * the browser chooses: it now comes from the session, on the server, through
 * `components/Session.tsx`. The machinery under test here is unchanged — a
 * `KeyValueStore` read decoded through a schema, a server value that keeps the
 * first client render matching the HTML — so the tests moved to the firm's
 * settings, which is still exactly that kind of value.
 */
const STORED = "oklaw.settings.v1";

const stored = (settings: Partial<typeof DEFAULT_SETTINGS>) =>
  JSON.stringify({ ...DEFAULT_SETTINGS, ...settings });

/**
 * Mounts an atom and waits for the store to answer.
 *
 * Every persisted atom starts at its default and settles on the stored value
 * once the read answers. Against `localStorage` that happens in the same tick,
 * but nothing about the atom promises it will — the read is an Effect through a
 * `KeyValueStore`, and the same atom over a store that goes to disk or over a
 * network would not. `hydratedRx` is the flag a screen waits on, so the tests
 * wait on the same one rather than on a number of ticks.
 */
const settled = async (registry: Registry.Registry): Promise<void> => {
  registry.mount(hydratedRx);
  await vi.waitUntil(() => registry.get(hydratedRx));
};

afterEach(() => {
  window.localStorage.clear();
});

describe("the session", () => {
  it("answers with the defaults when the store holds nothing", async () => {
    const registry = Registry.make();
    await settled(registry);

    expect(registry.get(settingsRx).firmName).toBe("OKLaw Advocates");
    expect(registry.get(recordsRx).clients).toEqual([]);
    expect(registry.get(settingsRx).currency).toBe("KES");
  });

  /**
   * The assertion that says there is no hydration mismatch.
   *
   * A server render has no `localStorage` and must produce the same HTML the
   * browser's first render does, or React throws the tree away and rebuilds it.
   * Every persisted atom therefore carries a server value — its default —
   * which `useSyncExternalStore` reads on the server *and* again while
   * hydrating. The stored role arrives on the commit after that.
   */
  it("renders the default on the server even when a value is stored", async () => {
    window.localStorage.setItem(STORED, stored({ firmName: "Wanjiru & Co" }));

    const registry = Registry.make();
    await settled(registry);

    expect(registry.get(settingsRx).firmName).toBe("Wanjiru & Co");
    expect(Rx.getServerValue(settingsRx, registry).firmName).toBe(
      "OKLaw Advocates",
    );
  });

  it("writes a chosen value through to the browser's store", async () => {
    const registry = Registry.make();
    await settled(registry);

    registry.set(settingsRx, { ...DEFAULT_SETTINGS, currency: "USD" });

    await vi.waitUntil(() =>
      (window.localStorage.getItem(STORED) ?? "").includes("USD"),
    );
    expect(window.localStorage.getItem(STORED)).toContain('"currency":"USD"');
  });

  it("reads it back in a registry that has never seen it", async () => {
    const first = Registry.make();
    await settled(first);
    first.set(settingsRx, { ...DEFAULT_SETTINGS, timezone: "Africa/Kampala" });
    await vi.waitUntil(() =>
      (window.localStorage.getItem(STORED) ?? "").includes("Kampala"),
    );

    // A second registry is a second tab, or the same one after a reload.
    const second = Registry.make();
    await settled(second);

    expect(second.get(settingsRx).timezone).toBe("Africa/Kampala");
  });

  /**
   * The reason the store is decoded rather than trusted.
   *
   * A stored value from a build that had different fields is not a value this
   * one can render — a missing `currency` would reach a formatter as
   * `undefined`. The schema refuses it at the boundary and the atom falls back
   * to the default, which is what a fresh browser does anyway.
   */
  it("refuses a stored value this build cannot make sense of", async () => {
    window.localStorage.setItem(STORED, '{"firmName":"Wanjiru & Co"}');

    const registry = Registry.make();
    await settled(registry);

    expect(registry.get(settingsRx).firmName).toBe("OKLaw Advocates");
  });

  it("survives a store that is not JSON at all", async () => {
    window.localStorage.setItem(STORED, "{ not json");

    const registry = Registry.make();
    await settled(registry);

    expect(registry.get(settingsRx).firmName).toBe("OKLaw Advocates");
  });

  it("keeps the values apart, so one bad key does not lose the rest", async () => {
    window.localStorage.setItem("oklaw.records.v1", "nonsense");

    const registry = Registry.make();
    await settled(registry);
    registry.set(settingsRx, { ...DEFAULT_SETTINGS, currency: "GBP" });

    expect(registry.get(settingsRx).currency).toBe("GBP");
    expect(registry.get(recordsRx).clients).toEqual([]);
  });

  it("carries the records the forms create across a reload", async () => {
    const registry = Registry.make();
    await settled(registry);

    registry.set(recordsRx, {
      ...registry.get(recordsRx),
      messages: [
        { from: "Wanjiku Mwangi", date: "19 Aug 2026", text: "Any news?" },
      ],
    });

    await vi.waitUntil(
      () => window.localStorage.getItem("oklaw.records.v1") !== null,
    );

    const second = Registry.make();
    await settled(second);
    expect(second.get(recordsRx).messages).toHaveLength(1);
  });

  it("layers a recorded payment over the seeded invoice", async () => {
    const registry = Registry.make();
    await settled(registry);

    registry.set(invoiceOverridesRx, { 3: "Paid" });

    const second = Registry.make();
    await vi.waitUntil(
      () => window.localStorage.getItem("oklaw.invoice-status.v1") !== null,
    );
    await settled(second);

    expect(second.get(invoiceOverridesRx)[3]).toBe("Paid");
  });
});
