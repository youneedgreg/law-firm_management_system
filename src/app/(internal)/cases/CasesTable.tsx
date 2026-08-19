"use client";

import Link from "next/link";
import { useAppState } from "@/components/AppState";
import { TableWrap } from "@/components/ui";
import type { CaseSummary } from "@/services/case-service";
import { SIGNED_IN_ADVOCATE } from "@/lib/data/cases";
import { caseStatusTag } from "@/lib/format";
import { courtName } from "./display";

/**
 * The caseload table.
 *
 * The rows arrive from the server already resolved — no fetching here, and no
 * seed arrays. What is left on the client is the role scoping, because the
 * current role lives in `localStorage` and the server has no way to read it.
 *
 * **That scoping is presentation, not authorization.** It hides rows an
 * Advocate/Lawyer has no reason to see; it does not stop anyone from reading
 * them, because the data has already been sent. The service takes an
 * `advocateId` filter and applies it in the query, which is where this belongs
 * and where Phase 6 moves it once there is a signed-in user to filter by.
 */
export function CasesTable({ caseload }: { caseload: readonly CaseSummary[] }) {
  const { role } = useAppState();

  const rows =
    role === "Advocate/Lawyer"
      ? caseload.filter(
          (summary) => summary.advocateName === SIGNED_IN_ADVOCATE,
        )
      : caseload;

  if (rows.length === 0) {
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
            <th>Client</th>
            <th>Court</th>
            <th>Advocate</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ matter, clientName, advocateName }) => (
            <tr key={matter.id}>
              <td>{matter.number}</td>
              <td>{matter.title}</td>
              <td>{matter.type}</td>
              <td>{clientName}</td>
              <td>{courtName(matter.court)}</td>
              <td>{advocateName}</td>
              <td>
                <span className={caseStatusTag(matter.status)}>
                  {matter.status}
                </span>
              </td>
              <td className="cell-action">
                <Link href={`/cases/${matter.id}`} className="btn btn-ghost">
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
