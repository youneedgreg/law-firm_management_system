"use client";

import { RegistryProvider } from "@effect-rx/rx-react";

/**
 * The registry the atoms live in, provided once at the root.
 *
 * React context is not available to Server Components, so this is the one
 * client boundary the layout needs — the same shape the `AppStateProvider` it
 * replaces had, and for the same reason.
 *
 * What is inside it is different. There is no state here, no value assembled in
 * a `useMemo` and handed down: the registry is a map from atom to node, and a
 * component that reads one subscribes to that node alone. The context object
 * this replaced re-rendered every consumer of every field whenever any field
 * changed.
 *
 * `defaultIdleTTL` is how long an atom's node survives after the last component
 * reading it unmounts. Without it a node is discarded the moment its last
 * reader goes, which for a screen keyed by a filter means going back to a
 * filter you were on ten seconds ago re-fetches it. Thirty seconds is short
 * enough that a matter closed in another tab is not shown as open for long —
 * and the caseload asks again on focus anyway — and long enough that moving
 * between two filters, or into a matter and back, is instant.
 */
export function RxRegistry({ children }: { children: React.ReactNode }) {
  return (
    <RegistryProvider defaultIdleTTL={30_000}>{children}</RegistryProvider>
  );
}
