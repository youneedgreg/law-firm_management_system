import { BackLink, SectionTitle } from "@/components/ui";
import { signatureTag } from "@/lib/format";
import type { FirmDocument } from "@/lib/types";

export function DocumentDetail({ document }: { document: FirmDocument }) {
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
        <button type="button" className="btn btn-secondary">
          <i className="ph-duotone ph-download-simple" aria-hidden /> Download
        </button>
        <button type="button" className="btn btn-ghost">
          <i className="ph-duotone ph-signature" aria-hidden /> Request
          e-signature
        </button>
      </div>

      <SectionTitle>Version history</SectionTitle>
      {document.versions.map((version) => (
        <div className="row row-tight" key={`${version.n}-${version.date}`}>
          v{version.n} — {version.date} by {version.by}
        </div>
      ))}

      <SectionTitle spaced>Tags</SectionTitle>
      {document.tags.length === 0 && <p className="dek">No tags.</p>}
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
