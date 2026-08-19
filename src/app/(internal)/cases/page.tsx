import Link from "next/link";
import { CASE_STATUSES, type CaseStatus } from "@/domain/case/status";
import { CasesTable, CasesTitle } from "./CasesTable";
import { NewCaseForm } from "./NewCaseForm";

/**
 * The caseload.
 *
 * Phase 3 read both the matters and the intake choices here, on the server,
 * through `CaseService`. Phase 5 moved both into atoms, and this page is what
 * is left: the filter, which is a URL, and the two components that answer to
 * it.
 *
 * That is a trade rather than an improvement, and it is worth stating which
 * way it goes. A server render reaches the database in-process — one query, no
 * hop — and this one asks the browser to make an HTTP request to a route that
 * makes the same query. What it buys is that the filter is answered without a
 * navigation, that the answer to each filter is cached in the browser rather
 * than recomputed, that a matter closed in another tab shows up when this one
 * regains focus, and that the loading and failure states are values the table
 * renders rather than a `loading.tsx` and an `error.tsx` for the whole segment.
 *
 * The matter *file* did not move, deliberately. It is the page you land on and
 * link to, it changes when the matter changes and not in response to anything
 * the browser does, and it is still read in-process by a Server Component.
 * Filtering is interaction; a file is a document.
 */
export default async function CasesPage({ searchParams }: PageProps<"/cases">) {
  const { status } = await searchParams;
  const active: CaseStatus | "all" = CASE_STATUSES.includes(
    status as CaseStatus,
  )
    ? (status as CaseStatus)
    : "all";

  return (
    <>
      <div className="page-head">
        <CasesTitle />
        <NewCaseForm />
      </div>

      <div className="filter-row">
        {(["all", ...CASE_STATUSES] as const).map((option) => (
          <Link
            key={option}
            href={
              option === "all"
                ? "/cases"
                : `/cases?status=${encodeURIComponent(option)}`
            }
            className={active === option ? "tag tag-accent" : "tag tag-outline"}
            aria-current={active === option ? "page" : undefined}
          >
            {option === "all" ? "All" : option}
          </Link>
        ))}
      </div>

      <CasesTable status={active} />
    </>
  );
}
