"use client";

import Link from "next/link";
import { useAppState } from "@/components/AppState";
import { TableWrap } from "@/components/ui";
import { CASES, SIGNED_IN_ADVOCATE } from "@/lib/data/cases";
import { caseStatusTag } from "@/lib/format";
import type { CaseStatus } from "@/lib/types";

/**
 * Role scoping happens here rather than on the server: an Advocate/Lawyer sees
 * only the matters assigned to them, and the current role lives in client state.
 */
export function CasesTable({ status }: { status: CaseStatus | "all" }) {
  const { role, records } = useAppState();

  const all = [...records.cases, ...CASES];
  const scoped =
    role === "Advocate/Lawyer"
      ? all.filter((legalCase) => legalCase.advocate === SIGNED_IN_ADVOCATE)
      : all;

  const cases = scoped.filter(
    (legalCase) => status === "all" || legalCase.status === status,
  );

  if (cases.length === 0) {
    return <p className="dek">No matters match this filter.</p>;
  }

  return (
    <TableWrap>
      <table className="table">
        <thead>
          <tr>
            <th>Case #</th>
            <th>Title</th>
            <th>Type</th>
            <th>Court</th>
            <th>Advocate</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {cases.map((legalCase) => (
            <tr key={legalCase.id}>
              <td>{legalCase.number}</td>
              <td>{legalCase.title}</td>
              <td>{legalCase.type}</td>
              <td>{legalCase.court}</td>
              <td>{legalCase.advocate}</td>
              <td>
                <span className={caseStatusTag(legalCase.status)}>
                  {legalCase.status}
                </span>
              </td>
              <td className="cell-action">
                <Link href={`/cases/${legalCase.id}`} className="btn btn-ghost">
                  Open
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export function CasesTitle() {
  const { role } = useAppState();
  return (
    <h1 className="page-title">
      {role === "Advocate/Lawyer" ? "My cases" : "Cases"}
    </h1>
  );
}
