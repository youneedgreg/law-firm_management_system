"use client";

import { usePathname } from "next/navigation";
import { itemForPath } from "@/lib/nav";

/**
 * What a screen shows while its data is still in flight.
 *
 * Next renders `loading.tsx` the moment a navigation starts and keeps the
 * layout — masthead, sidebar — in place, so what is missing is only ever the
 * content pane. Without one, a link click does nothing visible until the
 * server answers: on a Neon instance that has scaled to zero, that is the
 * better part of two seconds during which the previous page is still on
 * screen and the only evidence anything happened is the browser's own spinner.
 *
 * ## The heading is real, not a skeleton
 *
 * A page's title is a fact known before any query runs, and it is the same
 * fact after. Drawing a grey block where it goes would be pretending not to
 * know something, and then shifting the layout when the real one lands.
 *
 * It is not passed in either, which is the part worth explaining: every one of
 * these routes is already named in `lib/nav.ts`, and `itemForPath` resolves a
 * nested path to its section, so `/cases/{id}` answers "Cases" without being
 * told. Passing the title as a prop would be the same string written twice —
 * once in the page and once in the file that stands in for it — and the copy
 * that goes stale is always the one nobody looks at.
 *
 * ## What the shape is, and is not
 *
 * `shape` says roughly how the page is laid out, so the blocks land where the
 * content will. It duplicates a little of what the page knows about itself,
 * and unlike the title there is no single place that already holds it. That is
 * accepted rather than hidden: the worst a stale `shape` produces is a
 * skeleton in the wrong silhouette for a second, which is a cosmetic fault,
 * where a stale title would be a wrong claim about the page.
 */
export type SkeletonShape = "table" | "stats" | "rows" | "detail";

export function SegmentSkeleton({
  shape = "table",
}: {
  shape?: SkeletonShape;
}) {
  const item = itemForPath(usePathname());

  return (
    <>
      <div className="page-head">
        {item ? (
          <h1 className="page-title">{item.label}</h1>
        ) : (
          <div className="skeleton skeleton-title" />
        )}
      </div>

      {/*
        One announcement for the whole wait, and the blocks themselves hidden.
        A screen reader has nothing to gain from eleven unlabelled rectangles,
        and `role="status"` is polite — it waits for a pause rather than
        interrupting whatever is being read.
      */}
      <div role="status">
        <span className="visually-hidden">Loading</span>
        <div aria-hidden>
          {shape === "stats" && <StatsSkeleton />}
          {shape === "detail" && <DetailSkeleton />}
          {shape === "rows" && <RowsSkeleton />}
          {shape === "table" && <TableSkeleton />}
        </div>
      </div>
    </>
  );
}

/** Six rows under a head — the silhouette of every list screen here. */
function TableSkeleton() {
  return (
    <div className="skeleton-stack" style={{ marginTop: "var(--space-6)" }}>
      <div className="skeleton skeleton-sm" />
      {Array.from({ length: 6 }, (_, row) => (
        <div key={row} className="skeleton" />
      ))}
    </div>
  );
}

/** A figure row over a list: billing, time, tasks, reports, the dashboard. */
function StatsSkeleton() {
  return (
    <>
      <div className="stat-grid stat-grid-ruled">
        {Array.from({ length: 4 }, (_, cell) => (
          <div key={cell}>
            <div className="skeleton skeleton-sm" style={{ height: 12 }} />
            <div
              className="skeleton skeleton-md"
              style={{ height: 30, marginTop: "var(--space-1)" }}
            />
          </div>
        ))}
      </div>
      <TableSkeleton />
    </>
  );
}

/** A stack of records rather than a grid: the diary, notices, correspondence. */
function RowsSkeleton() {
  return (
    <div className="stack" style={{ marginTop: "var(--space-6)" }}>
      {Array.from({ length: 5 }, (_, row) => (
        <div key={row} className="row">
          <div className="skeleton skeleton-md" />
          <div
            className="skeleton skeleton-sm"
            style={{ height: 13, marginTop: 6 }}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * A file: a heading, then labelled facts about one record.
 *
 * The heading here *is* a block, unlike the page title above, and for the same
 * reason it is not one there — the name of a matter is the thing being fetched.
 */
function DetailSkeleton() {
  return (
    <>
      <div className="skeleton skeleton-md" style={{ height: 30 }} />
      <div className="detail-grid">
        <div className="skeleton-stack">
          {Array.from({ length: 6 }, (_, fact) => (
            <div key={fact} className="fact">
              <div
                className="skeleton"
                style={{ flex: "0 0 150px", height: 12 }}
              />
              <div className="skeleton skeleton-lg" />
            </div>
          ))}
        </div>
        <div className="skeleton-stack">
          {Array.from({ length: 3 }, (_, block) => (
            <div key={block} className="skeleton" style={{ height: 60 }} />
          ))}
        </div>
      </div>
    </>
  );
}
