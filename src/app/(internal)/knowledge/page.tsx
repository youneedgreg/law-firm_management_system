import { KNOWLEDGE } from "@/lib/data/firm";

export default function KnowledgePage() {
  return (
    <>
      <h1 className="page-title">Legal Research &amp; Knowledge Base</h1>
      <p className="page-subtitle">
        Acts, regulations, case law, templates and the firm&rsquo;s own
        precedent bank.
      </p>

      <input
        className="input search-field"
        type="search"
        placeholder="Search Acts, case law, templates, precedents…"
        aria-label="Search the knowledge base"
      />

      {KNOWLEDGE.map((item) => (
        <div className="row" key={item.id}>
          <div className="row-title">{item.title}</div>
          <div className="row-meta">
            {item.category} · {item.date}
          </div>
        </div>
      ))}
    </>
  );
}
