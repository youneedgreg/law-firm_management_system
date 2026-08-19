import Link from "next/link";
import { Effect } from "effect";
import { CASE_STATUSES, type CaseStatus } from "@/domain/case/status";
import { run } from "@/runtime";
import { CaseService } from "@/services/case-service";
import { CasesTable, CasesTitle } from "./CasesTable";
import { NewCaseForm } from "./NewCaseForm";

/**
 * The caseload, read from Postgres on the server.
 *
 * Two reads through `CaseService`, run in one pass on the runtime: the matters
 * with their names resolved, and the choices the intake form offers. Both are
 * effects, so `Effect.all` runs them concurrently and one failure fails the
 * page — which is the behaviour worth having, because a page that rendered a
 * caseload beside a form with no clients in it would look like it worked.
 *
 * The status filter is applied by the service rather than by the table. It is
 * the same filter the tests cover, and pushing it to the client would mean the
 * page always fetches everything and then hides most of it.
 */
export default async function CasesPage({ searchParams }: PageProps<"/cases">) {
  const { status } = await searchParams;
  const active: CaseStatus | "all" = CASE_STATUSES.includes(
    status as CaseStatus,
  )
    ? (status as CaseStatus)
    : "all";

  const { caseload, choices } = await run(
    Effect.gen(function* () {
      const service = yield* CaseService;
      const [caseload, choices] = yield* Effect.all(
        [
          service.caseload(active === "all" ? {} : { status: active }),
          service.intakeChoices(),
        ],
        { concurrency: "unbounded" },
      );
      return { caseload, choices };
    }),
  );

  return (
    <>
      <div className="page-head">
        <CasesTitle />
        <NewCaseForm choices={choices} />
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

      <CasesTable caseload={caseload} />
    </>
  );
}
