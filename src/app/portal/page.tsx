import { caseStatusTag } from "@/lib/format";
import { nextHearingForCase } from "@/lib/data/hearings";
import { PORTAL_CLIENT, portalCases } from "@/lib/data/portal";

export default function PortalHomePage() {
  const cases = portalCases();

  return (
    <>
      <h1 style={{ fontSize: 34, margin: "0 0 var(--space-2)" }}>
        Welcome back, {PORTAL_CLIENT.contact}
      </h1>
      <p className="page-subtitle" style={{ fontSize: 16 }}>
        Here&rsquo;s what&rsquo;s happening with your matters at OKLaw.
      </p>

      <div className="portal-grid">
        {cases.map((legalCase) => {
          const hearing = nextHearingForCase(legalCase.id);
          return (
            <article className="card elev-sm" key={legalCase.id}>
              <div className="card-kicker">
                {legalCase.type} · {legalCase.court}
              </div>
              <div className="card-title">{legalCase.title}</div>
              <div className="card-body">
                Status:{" "}
                <span className={caseStatusTag(legalCase.status)}>
                  {legalCase.status}
                </span>
              </div>
              <div className="card-meta">
                Next hearing: {hearing ? hearing.date : "Not yet scheduled"}
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
