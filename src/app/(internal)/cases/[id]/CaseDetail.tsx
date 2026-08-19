import Link from "next/link";
import * as Matter from "@/domain/case/case";
import * as Money from "@/domain/shared/money";
import { BackLink, SectionTitle } from "@/components/ui";
import { caseStatusTag } from "@/lib/format";
import type { CaseFile } from "@/services/case-service";
import { courtName, day, limitationSummary, urgencyTag } from "../display";
import { AmendCaseForm } from "./AmendCaseForm";
import { StatusPanel } from "./StatusPanel";

/** One labelled fact. The label sits in a fixed gutter so a column lines up. */
function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="fact">
      <span className="fact-label">{label}</span>
      <span className="fact-value">{children}</span>
    </div>
  );
}

/**
 * The matter file.
 *
 * What is shown is what the domain actually knows, which is a narrower and more
 * defensible set of facts than the wireframe's: no invented presiding judge, no
 * opposing counsel the system never captured. In exchange it shows two things
 * the wireframe could not, because they are computed rather than stored — the
 * limitation position, and the statuses this matter may legally move to.
 *
 * A Server Component. It renders values the page already fetched and holds no
 * state; the two interactive pieces below are the ones marked `"use client"`.
 */
export function CaseDetail({ file }: { file: CaseFile }) {
  const { matter, client, advocate, limitation } = file;
  const value = Matter.claimValue(matter);

  return (
    <>
      <BackLink href="/cases">Back to cases</BackLink>

      <div className="detail-head">
        <div>
          <div className="eyebrow">
            {matter.number} · {matter.type}
            {matter.causeNumber && ` · ${matter.causeNumber}`}
          </div>
          <h1 className="detail-title">{matter.title}</h1>
          <div className="dek">{courtName(matter.court)}</div>
          <div className="dek" style={{ marginTop: "var(--space-1)" }}>
            Client: <Link href={`/clients/${client.id}`}>{client.name}</Link> ·
            Advocate: {advocate.name}
          </div>
        </div>
        <span className={caseStatusTag(matter.status)}>{matter.status}</span>
      </div>

      <div className="detail-grid">
        <section>
          <SectionTitle>Particulars</SectionTitle>

          <Fact label="Claim value">
            {value === undefined ? (
              <span className="dek">
                No pecuniary value — which is a different thing from a claim
                worth nothing
              </span>
            ) : (
              Money.format(value)
            )}
          </Fact>

          <Fact label="File opened">{day(matter.openedOn)}</Fact>

          <Fact label="Filed in court">
            {matter.filedOn === undefined ? (
              <span className="dek">Not yet lodged</span>
            ) : (
              day(matter.filedOn)
            )}
          </Fact>

          <Fact label="Cause number">
            {matter.causeNumber ?? (
              <span className="dek">Assigned by the court on filing</span>
            )}
          </Fact>

          {matter.underCustomaryLaw && (
            <Fact label="Customary law">
              Exempt from the magistrates&rsquo; pecuniary limit (s. 7(3))
            </Fact>
          )}

          <SectionTitle spaced>Limitation</SectionTitle>
          {limitation === undefined ? (
            <p className="dek">
              No accrual date and basis are recorded, so no limitation date can
              be computed. Inventing one from the intake date would put a
              confident wrong figure in front of an advocate.
            </p>
          ) : (
            <>
              <div className="row row-tight">
                <span className={urgencyTag(limitation.urgency)}>
                  {limitationSummary(
                    limitation.daysRemaining,
                    limitation.urgency,
                  )}
                </span>
              </div>
              <Fact label="Expires">{day(limitation.window.expiresOn)}</Fact>
              <Fact label="Provision">{limitation.window.provision}</Fact>
              {limitation.window.note && (
                <p className="dek">{limitation.window.note}</p>
              )}
            </>
          )}
        </section>

        <section>
          <SectionTitle>Status</SectionTitle>
          <StatusPanel
            id={matter.id}
            status={matter.status}
            mayBeMovedTo={file.mayBeMovedTo}
          />

          <SectionTitle spaced>Particulars of the file</SectionTitle>
          <p className="dek">
            Everything on the left except the status, which moves through the
            lifecycle rather than being edited.
          </p>
          <div style={{ marginTop: "var(--space-3)" }}>
            <AmendCaseForm file={file} />
          </div>

          <SectionTitle spaced>Hearings, documents and invoices</SectionTitle>
          <p className="dek">
            Still on the wireframe&rsquo;s mock data. Each arrives with its own
            module, on the same repository and service boundary this matter now
            uses.
          </p>
        </section>
      </div>
    </>
  );
}
