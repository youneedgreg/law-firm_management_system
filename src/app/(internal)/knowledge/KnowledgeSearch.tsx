"use client";

import { useState } from "react";
import { SelectControl } from "@/components/form";
import { KNOWLEDGE } from "@/lib/data/firm";
import { KNOWLEDGE_CATEGORIES } from "@/lib/types";

/**
 * Search and category filter over the precedent bank. Both are controlled, so
 * the list narrows as you type rather than on submit.
 */
export function KnowledgeSearch() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");

  const term = query.trim().toLowerCase();
  const results = KNOWLEDGE.filter(
    (item) =>
      (category === "all" || item.category === category) &&
      (term === "" ||
        item.title.toLowerCase().includes(term) ||
        item.category.toLowerCase().includes(term)),
  );

  return (
    <>
      <div className="search-row">
        <input
          className="input"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search Acts, case law, templates, precedents…"
          aria-label="Search the knowledge base"
        />
        <SelectControl
          className="search-filter"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          aria-label="Filter by category"
          options={[
            { value: "all", label: "All categories" },
            ...KNOWLEDGE_CATEGORIES.map((name) => ({
              value: name,
              label: name,
            })),
          ]}
        />
      </div>

      {results.length === 0 && (
        <p className="dek">Nothing in the bank matches that search.</p>
      )}

      {results.map((item) => (
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
