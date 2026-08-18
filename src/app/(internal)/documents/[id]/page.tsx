import { CreatedDocument } from "./CreatedDocument";
import { DocumentDetail } from "./DocumentDetail";
import { DOCUMENTS, getDocument } from "@/lib/data/documents";

export function generateStaticParams() {
  return DOCUMENTS.map((document) => ({ id: String(document.id) }));
}

export default async function DocumentDetailPage({
  params,
}: PageProps<"/documents/[id]">) {
  const { id } = await params;
  const document = getDocument(Number(id));

  // Outside the seed data, the document was uploaded in this browser session.
  if (!document) return <CreatedDocument id={Number(id)} />;

  return <DocumentDetail document={document} />;
}
