import Link from "next/link";
import { PageHead } from "@/components/ui";
import { DOCUMENTS } from "@/lib/data/documents";
import { signatureTag } from "@/lib/format";
import { DOCUMENT_CATEGORIES, type DocumentCategory } from "@/lib/types";

export default async function DocumentsPage({
  searchParams,
}: PageProps<"/documents">) {
  const { category } = await searchParams;
  const active: DocumentCategory | "all" = DOCUMENT_CATEGORIES.includes(
    category as DocumentCategory,
  )
    ? (category as DocumentCategory)
    : "all";

  const documents = DOCUMENTS.filter(
    (document) => active === "all" || document.category === active,
  );

  return (
    <>
      <PageHead title="Documents">
        <span className="btn btn-primary">
          <i className="ph-duotone ph-upload-simple" aria-hidden /> Upload
        </span>
      </PageHead>

      <div className="filter-row">
        {(["all", ...DOCUMENT_CATEGORIES] as const).map((category) => (
          <Link
            key={category}
            href={
              category === "all"
                ? "/documents"
                : `/documents?category=${encodeURIComponent(category)}`
            }
            className={active === category ? "tag tag-accent" : "tag tag-outline"}
            aria-current={active === category ? "page" : undefined}
          >
            {category === "all" ? "All" : category}
          </Link>
        ))}
      </div>

      <div className="card-grid">
        {documents.map((document) => (
          <Link
            key={document.id}
            href={`/documents/${document.id}`}
            className="card elev-sm"
            style={{ color: "inherit", textDecoration: "none" }}
          >
            <div className="card-kicker">{document.category}</div>
            <div className="card-title" style={{ fontSize: 16 }}>
              {document.name}
            </div>
            <div className="card-meta">
              {document.case} · v{document.version} · {document.date}
            </div>
            <div>
              <span className={signatureTag(document.sigStatus)}>
                {document.sigStatus}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
