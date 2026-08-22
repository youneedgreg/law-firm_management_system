"use client";

import { Result, useRxValue } from "@effect-rx/rx-react";
import Link from "next/link";
import { TableWrap } from "@/components/ui";
import type { CaseStatus } from "@/domain/case/status";
import type { Principal } from "@/domain/identity/principal";
import type { AdvocateId } from "@/domain/shared/ids";
import { useSession } from "@/components/Session";
import { caseStatusTag } from "@/lib/format";
import { caseloadRx } from "@/rx/cases";
import { explain } from "@/rx/failure";
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
 * **An advocate's own matters are a default view, not a restriction.** Phase 5
 * filtered the rows here, in the browser, against a hard-coded name from the
 * seed data. The advocate id now comes from the session and goes to the
 * service, which applies it in the query — so "my cases" fetches the matters it
 * shows rather than fetching every matter and hiding most.
 *
 * That is still presentation. The scoping that is a security boundary is the
 * portal's, it is decided in `services/policy.ts` from the signed-in
 * principal, and no component is party to it.
 */
export function CasesTable({ status }: { status: CaseStatus | "all" }) {
  const mine = ownMatters(useSession().principal);
  const caseload = useRxValue(caseloadRx({ status, advocateId: mine }));

  return (
    Result.builder(caseload)
      /*
       * `role="status"` because the table that replaces this appears with no
       * other signal: the filter above is a link, so a sighted user sees the
       * page change and a screen-reader user is told nothing at all. A polite
       * live region announces the wait and then the count below it.
       */
      .onInitial(() => (
        <p className="dek" role="status">
          Reading the caseload…
        </p>
      ))
      .onError((error) => (
        <p className="form-refusal" role="alert">
          {explain(error)}
        </p>
      ))
      .onSuccess((caseload) => {
        const rows = caseload;

        if (rows.length === 0) {
          return (
            <p className="dek" role="status">
              No matters match this filter.
            </p>
          );
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
                  <th>
                    <span className="visually-hidden">Actions</span>
                  </th>
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
      .render()
  );
}

export function CasesTitle() {
  const mine = ownMatters(useSession().principal);
  return <h1 className="page-title">{mine ? "My cases" : "Cases"}</h1>;
}

/**
 * Which advocate's matters to show, or every one of them.
 *
 * An Advocate lands on their own caseload because that is the working list they
 * came for; a Managing Partner, a Finance Officer and a Receptionist all want
 * the firm's. It is a default view rather than a restriction — the filter is a
 * URL away, and the service would serve it.
 */
const ownMatters = (principal: Principal): AdvocateId | undefined =>
  principal._tag === "Staff" && principal.role === "Advocate"
    ? principal.advocateId
    : undefined;
