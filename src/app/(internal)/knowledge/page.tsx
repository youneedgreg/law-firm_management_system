import { KnowledgeSearch } from "./KnowledgeSearch";

export default function KnowledgePage() {
  return (
    <>
      <h1 className="page-title">Legal Research &amp; Knowledge Base</h1>
      <p className="page-subtitle">
        Acts, regulations, case law, templates and the firm&rsquo;s own
        precedent bank.
      </p>

      <KnowledgeSearch />
    </>
  );
}
