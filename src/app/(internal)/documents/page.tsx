import Link from "next/link";
import { DocumentGrid, UploadDocumentForm } from "./DocumentsScreen";
import { PageHead } from "@/components/ui";
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

  return (
    <>
      <PageHead title="Documents">
        <UploadDocumentForm />
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
            className={
              active === category ? "tag tag-accent" : "tag tag-outline"
            }
            aria-current={active === category ? "page" : undefined}
          >
            {category === "all" ? "All" : category}
          </Link>
        ))}
      </div>

      <DocumentGrid category={active} />
    </>
  );
}
