import Link from "next/link";
import { Effect } from "effect";
import {
  Empty,
  PageHead,
  SectionTitle,
  Stat,
  TableWrap,
} from "@/components/ui";
import { CATEGORIES, type Category } from "@/domain/document/document";
import { may } from "@/domain/identity/permissions";
import { signatureTag } from "@/lib/format";
import { runAs, signedIn } from "@/runtime/session";
import { CaseService } from "@/services/case-service";
import { DocumentService } from "@/services/document-service";
import { formatSize } from "./forms";
import { UploadDocumentForm } from "./UploadDocumentForm";

/**
 * The document register, read from Postgres.
 *
 * A Server Component. The register is a record of what is on the firm's files,
 * and the one piece of interaction it offers — filtering by category — is a
 * link, because a filtered register is a *place* worth linking a colleague to
 * rather than a state that lives in one person's browser.
 *
 * ## A table, where the prototype had cards
 *
 * The prototype rendered a grid of cards. A card holds a name and about two
 * facts; the register has six that matter — matter, category, version, size,
 * signature, and whether it has been filed — and the last of those is the one
 * that decides whether a document can still be changed. Cards would have hidden
 * it, so this is a table.
 *
 * ## What is deliberately absent
 *
 * There is no preview and no inline viewer. The bytes live in a private store
 * and are fetched straight from the CDN with a signed URL, so rendering them
 * here would mean pulling every document through this server to show a
 * thumbnail nobody asked for. Download is a link, and the link is the feature.
 */
export default async function DocumentsPage({
  searchParams,
}: PageProps<"/documents">) {
  const { category } = await searchParams;
  const active: Category | "all" = CATEGORIES.includes(category as Category)
    ? (category as Category)
    : "all";

  const principal = await signedIn();
  const mayUpload = may(principal, "document:write");

  const [register, matters] = await runAs(
    Effect.all(
      [
        Effect.flatMap(DocumentService, (service) => service.register()),
        mayUpload
          ? Effect.flatMap(CaseService, (cases) => cases.caseload()).pipe(
              Effect.map((rows) =>
                rows.map((row) => ({
                  id: row.matter.id,
                  number: row.matter.number,
                  title: row.matter.title,
                })),
              ),
              /**
               * The matter list only exists to populate the upload dropdown, so
               * a caller who cannot read the caseload gets a form with no
               * matters rather than a page that will not render.
               */
              Effect.catchTag("NotPermitted", () => Effect.succeed([])),
            )
          : Effect.succeed([]),
      ],
      { concurrency: "unbounded" },
    ),
  );

  const shown =
    active === "all"
      ? register
      : register.filter((entry) => entry.document.category === active);

  const awaitingSignature = register.filter(
    (entry) => entry.document.signatureStatus === "Awaiting signature",
  ).length;
  const filed = register.filter(
    (entry) => entry.document.filedWithCourt,
  ).length;
  const held = register.reduce(
    (total, entry) => total + entry.current.sizeBytes,
    0,
  );

  return (
    <>
      <PageHead title="Documents">
        {mayUpload ? <UploadDocumentForm matters={matters} /> : null}
      </PageHead>
      <p className="page-subtitle">
        Pleadings, contracts, affidavits and correspondence, held against the
        matter they belong to. Versions are append-only &mdash; a document filed
        with the court is fixed, and a correction to one is a fresh document.
      </p>

      <div className="stat-grid" style={{ marginBottom: "var(--space-6)" }}>
        <Stat label="Documents" value={String(register.length)} small />
        {awaitingSignature > 0 ? (
          <Stat
            label="Awaiting signature"
            value={String(awaitingSignature)}
            tone="accent-2"
            small
          />
        ) : (
          <Stat label="Awaiting signature" value="0" small />
        )}
        <Stat label="Filed with court" value={String(filed)} small />
        <Stat label="Held" value={formatSize(held)} tone="accent" small />
      </div>

      <div className="filter-row">
        {(["all", ...CATEGORIES] as const).map((each) => (
          <Link
            key={each}
            href={
              each === "all"
                ? "/documents"
                : `/documents?category=${encodeURIComponent(each)}`
            }
            className={active === each ? "tag tag-accent" : "tag tag-outline"}
            aria-current={active === each ? "page" : undefined}
          >
            {each === "all" ? "All" : each}
          </Link>
        ))}
      </div>

      <SectionTitle spaced>
        {active === "all" ? "Every document" : active}
      </SectionTitle>

      {shown.length === 0 ? (
        <Empty>
          {register.length === 0
            ? "No documents have been uploaded."
            : "No documents are filed under this category."}
        </Empty>
      ) : (
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th>Document</th>
                <th>Matter</th>
                <th>Category</th>
                <th>Version</th>
                <th>Size</th>
                <th>Signature</th>
                <th>
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((entry) => (
                <tr key={entry.document.id}>
                  <td>
                    <Link
                      href={`/documents/${entry.document.id}`}
                      className="cell-strong"
                    >
                      {entry.document.name}
                    </Link>
                    <div className="dek">
                      {entry.current.uploadedOn.toLocaleDateString("en-KE")}
                    </div>
                  </td>
                  <td>
                    {entry.matterNumber}
                    <div className="dek">{entry.matterTitle}</div>
                  </td>
                  <td>{entry.document.category}</td>
                  <td>v{entry.versionCount}</td>
                  <td>{formatSize(entry.current.sizeBytes)}</td>
                  <td>
                    <span
                      className={signatureTag(entry.document.signatureStatus)}
                    >
                      {entry.document.signatureStatus}
                    </span>
                    {/*
                      Filed is shown next to the signature because together they
                      answer the only question anybody asks of a row here: can
                      this still be changed?
                    */}
                    {entry.document.filedWithCourt ? (
                      <span className="dek"> · filed</span>
                    ) : null}
                  </td>
                  <td className="cell-action">
                    <a
                      className="btn btn-ghost btn-sm"
                      href={`/documents/${entry.document.id}/download`}
                    >
                      <i
                        className="ph-duotone ph-download-simple"
                        aria-hidden
                      />
                      Download
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </>
  );
}
