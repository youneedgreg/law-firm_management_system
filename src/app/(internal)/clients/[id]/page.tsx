import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink, SectionTitle } from "@/components/ui";
import { casesForClient } from "@/lib/data/cases";
import {
  CLIENTS,
  clientContacts,
  clientTypeLabel,
  engagementHistory,
  getClient,
} from "@/lib/data/clients";
import { documentsForCaseNumbers } from "@/lib/data/documents";
import { caseStatusTag } from "@/lib/format";

export function generateStaticParams() {
  return CLIENTS.map((client) => ({ id: String(client.id) }));
}

export default async function ClientDetailPage({
  params,
}: PageProps<"/clients/[id]">) {
  const { id } = await params;
  const client = getClient(Number(id));
  if (!client) notFound();

  const cases = casesForClient(client.id);
  const documents = documentsForCaseNumbers(cases.map((c) => c.number));

  return (
    <>
      <BackLink href="/clients">Back to clients</BackLink>

      <div className="detail-head">
        <div>
          <div className="eyebrow">
            {clientTypeLabel(client, true)} · #{client.number}
          </div>
          <h1 className="detail-title">{client.name}</h1>
          <div className="dek">
            {client.contact} · {client.email} · {client.phone}
          </div>
        </div>
        <span className="tag tag-accent-2">{client.conflictStatus}</span>
      </div>

      <div className="detail-grid">
        <section>
          <SectionTitle>Cases</SectionTitle>
          {cases.length === 0 && <p className="dek">No matters on file yet.</p>}
          {cases.map((legalCase) => (
            <Link
              key={legalCase.id}
              href={`/cases/${legalCase.id}`}
              className="row row-tight row-split row-link"
            >
              <span>{legalCase.title}</span>
              <span className={caseStatusTag(legalCase.status)}>
                {legalCase.status}
              </span>
            </Link>
          ))}

          <SectionTitle spaced>Documents</SectionTitle>
          {documents.length === 0 && (
            <p className="dek">No documents filed for this client.</p>
          )}
          {documents.map((document) => (
            <Link
              key={document.id}
              href={`/documents/${document.id}`}
              className="line-muted row-link"
            >
              {document.name}
            </Link>
          ))}
        </section>

        <section>
          <SectionTitle>Engagement history</SectionTitle>
          {engagementHistory().map((engagement) => (
            <div className="row row-tight" key={engagement.date}>
              <span className="eyebrow">{engagement.date}</span> —{" "}
              {engagement.text}
            </div>
          ))}

          <SectionTitle spaced>Contacts</SectionTitle>
          {clientContacts(client).map((contact) => (
            <div className="line-muted" key={contact.name}>
              {contact.name} — {contact.role}
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
