import { Effect } from "effect";
import { caseStatusTag } from "@/lib/format";
import { runAs } from "@/runtime/session";
import { CaseService } from "@/services/case-service";
import { courtName } from "../../(internal)/cases/display";

/**
 * A client's own matters, read as that client.
 *
 * The whole page is four lines of data access and every one of Phase 6's claims
 * is behind them. `runAs` resolves the principal from a verified session;
 * `caseload()` requires `CurrentUser` and cannot be called without one; the
 * scope derived from that principal turns the read into `forClient`, so the
 * other five clients' matters are not fetched and filtered — they are never
 * fetched. There is no `where` clause in this file to get wrong.
 *
 * It used to be `portalCases()` from `lib/data/portal.ts`, which picked one
 * client by number because there was no session to read one from.
 */
export default async function PortalCasesPage() {
  const caseload = await runAs(
    Effect.flatMap(CaseService, (service) => service.caseload()),
  );

  return (
    <>
      <h2 style={{ fontSize: 28, margin: "0 0 var(--space-4)" }}>
        Case progress
      </h2>

      {caseload.length === 0 && (
        <p className="dek">
          You have no matters on file with us. If you were expecting one, your
          advocate will be able to say where it is.
        </p>
      )}

      {caseload.map(({ matter, advocateName }) => (
        <section key={matter.id} style={{ marginBottom: "var(--space-6)" }}>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 20 }}>
            {matter.title}
          </div>
          <div
            className="dek"
            style={{ margin: "var(--space-1) 0 var(--space-3)" }}
          >
            {matter.number} · {courtName(matter.court)} · {advocateName}
            {matter.filedOn === undefined
              ? " · Not yet filed"
              : ` · Filed ${matter.filedOn.toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}`}
          </div>
          <div className="tag-row">
            <span className={caseStatusTag(matter.status)}>
              {matter.status}
            </span>
            {matter.causeNumber !== undefined && (
              <span className="tag tag-outline">{matter.causeNumber}</span>
            )}
          </div>
        </section>
      ))}
    </>
  );
}
