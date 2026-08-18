import { notFound } from "next/navigation";
import { BackLink, SectionTitle } from "@/components/ui";
import { DOCUMENTS, getDocument } from "@/lib/data/documents";
import { signatureTag } from "@/lib/format";

export function generateStaticParams() {
  return DOCUMENTS.map((document) => ({ id: String(document.id) }));
}

export default async function DocumentDetailPage({
  params,
}: PageProps<"/documents/[id]">) {
  const { id } = await params;
  const document = getDocument(Number(id));
  if (!document) notFound();

  return (
    <>
      <BackLink href="/documents">Back to documents</BackLink>

      <h1 className="detail-title">{document.name}</h1>
      <div className="dek" style={{ marginBottom: "var(--space-4)" }}>
        {document.category} · {document.case} · uploaded {document.date} ·{" "}
        <span className={signatureTag(document.sigStatus)}>
          {document.sigStatus}
        </span>
      </div>

      <div className="action-row">
        <span className="btn btn-secondary">
          <i className="ph-duotone ph-download-simple" aria-hidden /> Download
        </span>
        <span className="btn btn-ghost">
          <i className="ph-duotone ph-signature" aria-hidden /> Request
          e-signature
        </span>
      </div>

      <SectionTitle>Version history</SectionTitle>
      {document.versions.map((version) => (
        <div className="row row-tight" key={`${version.n}-${version.date}`}>
          v{version.n} — {version.date} by {version.by}
        </div>
      ))}

      <SectionTitle spaced>Tags</SectionTitle>
      <div className="tag-row">
        {document.tags.map((tag) => (
          <span className="tag tag-neutral" key={tag}>
            {tag}
          </span>
        ))}
      </div>
    </>
  );
}
