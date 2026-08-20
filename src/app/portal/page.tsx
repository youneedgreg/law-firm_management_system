import { Effect } from "effect";
import { caseStatusTag } from "@/lib/format";
import { runAs, signedIn } from "@/runtime/session";
import { CaseService } from "@/services/case-service";
import { courtName } from "../(internal)/cases/display";

/**
 * The portal's front page, addressed to whoever signed in.
 *
 * The name in the greeting is the session's, not `PORTAL_CLIENT.contact` from
 * the seed data — which is the smallest visible difference this phase makes and
 * the one that says the most: the page used to be about a client the fixtures
 * had chosen, and is now about the person reading it.
 */
export default async function PortalHomePage() {
  const [principal, caseload] = await Promise.all([
    signedIn(),
    runAs(Effect.flatMap(CaseService, (service) => service.caseload())),
  ]);

  return (
    <>
      <h1 style={{ fontSize: 34, margin: "0 0 var(--space-2)" }}>
        Welcome back, {principal.name}
      </h1>
      <p className="page-subtitle" style={{ fontSize: 16 }}>
        {caseload.length === 0
          ? "You have no matters open with us at the moment."
          : `Here's what's happening with your ${
              caseload.length === 1 ? "matter" : "matters"
            } at OKLaw.`}
      </p>

      <div className="portal-grid">
        {caseload.map(({ matter, advocateName }) => (
          <article className="card elev-sm" key={matter.id}>
            <div className="card-kicker">
              {matter.type} · {courtName(matter.court)}
            </div>
            <div className="card-title">{matter.title}</div>
            <div className="card-body">
              Status:{" "}
              <span className={caseStatusTag(matter.status)}>
                {matter.status}
              </span>
            </div>
            <div className="card-meta">
              Carried by {advocateName} · {matter.number}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
