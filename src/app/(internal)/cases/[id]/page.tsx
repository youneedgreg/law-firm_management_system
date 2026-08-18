import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink, SectionTitle } from "@/components/ui";
import { CASES, getCase } from "@/lib/data/cases";
import { getClient } from "@/lib/data/clients";
import { caseStatusTag } from "@/lib/format";

export function generateStaticParams() {
  return CASES.map((legalCase) => ({ id: String(legalCase.id) }));
}

export default async function CaseDetailPage({
  params,
}: PageProps<"/cases/[id]">) {
  const { id } = await params;
  const legalCase = getCase(Number(id));
  if (!legalCase) notFound();

  const client = getClient(legalCase.clientId);

  return (
    <>
      <BackLink href="/cases">Back to cases</BackLink>

      <div className="detail-head">
        <div>
          <div className="eyebrow">
            #{legalCase.number} · {legalCase.type} · {legalCase.practiceArea}
          </div>
          <h1 className="detail-title">{legalCase.title}</h1>
          <div className="dek">
            {legalCase.court} · {legalCase.judge} · Opposing:{" "}
            {legalCase.opposingCounsel} · Filed {legalCase.filed}
          </div>
          {client && (
            <div className="dek" style={{ marginTop: "var(--space-1)" }}>
              Client:{" "}
              <Link href={`/clients/${client.id}`}>{client.name}</Link> ·
              Advocate: {legalCase.advocate}
            </div>
          )}
        </div>
        <span className={caseStatusTag(legalCase.status)}>{legalCase.status}</span>
      </div>

      <div className="detail-grid">
        <section>
          <SectionTitle>Case timeline</SectionTitle>
          {legalCase.timeline.map((event) => (
            <div className="row row-tight" key={`${event.date}-${event.text}`}>
              <span
                className="eyebrow"
                style={{ display: "inline-block", width: 90 }}
              >
                {event.date}
              </span>
              {event.text}
            </div>
          ))}

          <SectionTitle spaced>Internal notes</SectionTitle>
          {legalCase.notes.map((note) => (
            <div className="line-muted" key={note}>
              {note}
            </div>
          ))}
        </section>

        <section>
          <SectionTitle>Hearing history</SectionTitle>
          {legalCase.hearings.map((hearing) => (
            <div className="row row-tight" key={`${hearing.date}-${hearing.outcome}`}>
              {hearing.date} — {hearing.court} ({hearing.outcome})
            </div>
          ))}

          <SectionTitle spaced>Related documents</SectionTitle>
          {legalCase.documents.map((document) => (
            <div className="line-muted" key={document}>
              {document}
            </div>
          ))}

          <SectionTitle spaced>Related invoices</SectionTitle>
          {legalCase.invoices.map((invoice) => (
            <div className="line-muted" key={invoice}>
              {invoice}
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
