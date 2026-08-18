import Link from "next/link";
import { BackLink, SectionTitle } from "@/components/ui";
import {
  clientContacts,
  clientTypeLabel,
  engagementHistory,
} from "@/lib/data/clients";
import { caseStatusTag } from "@/lib/format";
import type { Case, Client, FirmDocument } from "@/lib/types";

/**
 * The client file. Presentational, so the same layout serves both the seeded
 * clients rendered on the server and the ones the intake form created, which
 * only exist in the browser session.
 */
export function ClientDetail({
  client,
  cases,
  documents,
}: {
  client: Client;
  cases: Case[];
  documents: FirmDocument[];
}) {
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
