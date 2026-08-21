import Link from "next/link";
import { BackLink, SectionTitle } from "@/components/ui";
import type { DocumentOnFile } from "@/services/document-service";
import { formatSize } from "../forms";
import { signatureTag } from "@/lib/format";
import { FileWithCourtButton } from "./FileWithCourt";
import { ReviseDocumentForm } from "./ReviseDocument";

/**
 * One document, and its history.
 *
 * The version list is the substance of this page. Everywhere else in the system
 * a record shows its current state; a document shows every state it has ever
 * had, because that is what makes "what did the version we filed actually say?"
 * an answerable question — and each version keeps its own storage key, so an
 * old one is still downloadable rather than merely listed.
 *
 * The two actions are asymmetric on purpose. **Revise** adds; **File with
 * court** closes. Once filed, revision refuses, so the filing button says what
 * it costs before it is pressed rather than afterwards.
 */
export function DocumentDetail({
  summary,
  mayWrite,
}: {
  summary: DocumentOnFile;
  mayWrite: boolean;
}) {
  const { document, matterNumber, matterTitle, current, uploaders } = summary;
  const history = [...document.versions].reverse();

  return (
    <>
      <BackLink href="/documents">Back to documents</BackLink>

      <h1 className="detail-title">{document.name}</h1>
      <div className="dek" style={{ marginBottom: "var(--space-4)" }}>
        {document.category} ·{" "}
        <Link href={`/cases/${document.caseId}`}>{matterNumber}</Link>{" "}
        {matterTitle} · v{current.number} ·{" "}
        {current.uploadedOn.toLocaleDateString("en-KE")} ·{" "}
        <span className={signatureTag(document.signatureStatus)}>
          {document.signatureStatus}
        </span>
        {document.filedWithCourt ? (
          <span className="tag tag-neutral" style={{ marginLeft: 8 }}>
            Filed with court
          </span>
        ) : null}
      </div>

      <div className="action-row">
        {/*
          An anchor, not a button. The href is a real route that mints a signed
          URL and redirects to it, so this works before hydration and can be
          opened in a new tab like any other link.
        */}
        <a
          className="btn btn-secondary"
          href={`/documents/${document.id}/download`}
        >
          <i className="ph-duotone ph-download-simple" aria-hidden /> Download v
          {current.number}
        </a>

        {mayWrite && !document.filedWithCourt ? (
          <>
            <ReviseDocumentForm id={document.id} name={document.name} />
            <FileWithCourtButton id={document.id} name={document.name} />
          </>
        ) : null}
      </div>

      {document.filedWithCourt ? (
        <p className="dek" style={{ marginTop: "var(--space-3)" }}>
          This document is on the court record and cannot be revised. A
          correction is a fresh document, not a new version of this one.
        </p>
      ) : null}

      <SectionTitle spaced>Version history</SectionTitle>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Version</th>
              <th>Uploaded</th>
              <th>By</th>
              <th>Size</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {history.map((version) => (
              <tr key={version.number}>
                <td className="cell-strong">
                  v{version.number}
                  {version.number === current.number ? (
                    <span className="dek"> · current</span>
                  ) : null}
                </td>
                <td>{version.uploadedOn.toLocaleDateString("en-KE")}</td>
                <td>{uploaders[version.uploadedBy] ?? "Unknown"}</td>
                <td>{formatSize(version.sizeBytes)}</td>
                <td className="cell-action">
                  {/*
                    Only the current version has a download link. The older
                    objects are still in the store under their own keys, and
                    signing one is a different request the service does not
                    offer yet — offering a link that 404s would be worse than
                    offering none, so the row says what it can.
                  */}
                  {version.number === current.number ? (
                    <a
                      className="btn btn-ghost btn-sm"
                      href={`/documents/${document.id}/download`}
                    >
                      Download
                    </a>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
