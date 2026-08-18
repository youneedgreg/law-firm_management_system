import Link from "next/link";
import { CasesTable, CasesTitle } from "./CasesTable";
import { NewCaseForm } from "./NewCaseForm";
import { CASE_STATUSES, type CaseStatus } from "@/lib/types";

export default async function CasesPage({ searchParams }: PageProps<"/cases">) {
  const { status } = await searchParams;
  const active: CaseStatus | "all" = CASE_STATUSES.includes(status as CaseStatus)
    ? (status as CaseStatus)
    : "all";

  return (
    <>
      <div className="page-head">
        <CasesTitle />
        <NewCaseForm />
      </div>

      <div className="filter-row">
        {(["all", ...CASE_STATUSES] as const).map((status) => (
          <Link
            key={status}
            href={
              status === "all"
                ? "/cases"
                : `/cases?status=${encodeURIComponent(status)}`
            }
            className={active === status ? "tag tag-accent" : "tag tag-outline"}
            aria-current={active === status ? "page" : undefined}
          >
            {status === "all" ? "All" : status}
          </Link>
        ))}
      </div>

      <CasesTable status={active} />
    </>
  );
}
