"use client";

import { Result, useRxValue } from "@effect-rx/rx-react";
import Link from "next/link";
import { TableWrap } from "@/components/ui";
import type { CaseStatus } from "@/domain/case/status";
import { SIGNED_IN_ADVOCATE } from "@/lib/data/cases";
import { caseStatusTag } from "@/lib/format";
import { caseloadRx } from "@/rx/cases";
import { explain } from "@/rx/failure";
import { roleRx } from "@/rx/session";
import { courtName } from "./display";

/**
 * The caseload table.
 *
 * The rows are an atom now rather than a prop. The filter above the table is
 * still a link and still a URL — a filtered caseload is a thing you send
 * someone — but the matters behind it are fetched by the browser through the
 * client the contract generates, which is what lets the same page answer for
 * six filters without six server renders. `caseloadRx` is a family keyed by the
 * filter, so each one has its own cached answer and going back to one already
 * seen is instant.
 *
 * Three states, and all three are the same value in different shapes.
 * `Result.Initial` is the read in flight, `Result.Failure` carries the reason,
 * and `Result.Success` has the rows. There is no `isLoading` boolean beside a
 * `rows` array beside an `error` string, which is the arrangement where two of
 * the three are wrong at once.
 *
 * **A defect is deliberately not handled here.** `render()` re-throws anything
 * that is not a typed failure, so a bug reaches `error.tsx` — the same division
 * the server draws between a refusal it returns and a defect it dies on.
 *
 * **The role scoping is presentation, not authorization.** It hides rows an
 * Advocate/Lawyer has no reason to see; it does not stop anyone from reading
 * them, because the API served them. The service takes an `advocateId` filter
 * and applies it in the query, which is where this belongs and where Phase 6
 * moves it once there is a signed-in user to filter by.
 */
export function CasesTable({ status }: { status: CaseStatus | "all" }) {
  const role = useRxValue(roleRx);
  const caseload = useRxValue(caseloadRx(status));

  return Result.builder(caseload)
    .onInitial(() => <p className="dek">Reading the caseload…</p>)
    .onError((error) => (
      <p className="form-refusal" role="alert">
        {explain(error)}
      </p>
    ))
    .onSuccess((caseload) => {
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
                    <Link
                      href={`/cases/${matter.id}`}
                      className="btn btn-ghost"
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      );
    })
    .render();
}

export function CasesTitle() {
  const role = useRxValue(roleRx);
  return (
    <h1 className="page-title">
      {role === "Advocate/Lawyer" ? "My cases" : "Cases"}
    </h1>
  );
}
