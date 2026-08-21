"use client";

import { useState } from "react";
import { Option } from "effect";
import { SelectControl } from "@/components/form";
import {
  CATEGORIES,
  isStale,
  lastVerified,
  matching,
  type Precedent,
} from "@/domain/firm/precedent";

/**
 * Search and filter over the bank.
 *
 * Both controlled, so the list narrows as you type rather than on submit — and
 * both operating on a list the server already sent. A firm's precedent bank is
 * tens of entries; a request per keystroke to filter forty rows would be slower
 * and would put the matching rule in SQL, away from the tests that check it.
 *
 * `matching` is the **domain's** function, not a `filter` written here. It is
 * the reason "employment act" finds "Employment Act, 2007 (annotated)" — terms
 * match independently, so the comma does not defeat it — and that behaviour is
 * tested once rather than reimplemented per screen.
 */
export function KnowledgeSearch({
  bank,
  asAt,
}: {
  bank: readonly Precedent[];
  asAt: Date;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");

  const results = matching(bank, query).filter(
    (precedent) => category === "all" || precedent.category === category,
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
            ...CATEGORIES.map((name) => ({ value: name, label: name })),
          ]}
        />
      </div>

      {results.length === 0 && (
        <p className="dek">Nothing in the bank matches that search.</p>
      )}

      {results.map((precedent) => (
        <div className="row" key={precedent.id}>
          <div className="row-title">
            {precedent.title}
            {/*
              The staleness marker travels with the entry rather than living
              only in the section above, because this is the list people
              actually search — and finding a precedent through search is
              exactly when nobody scrolls up to check the warnings.
            */}
            {isStale(precedent, asAt) ? (
              <span className="tag tag-outline" style={{ marginLeft: 8 }}>
                Needs checking
              </span>
            ) : null}
          </div>
          <div className="row-meta">
            {precedent.category} · {precedent.location} ·{" "}
            {Option.isNone(precedent.reviewedOn)
              ? `filed ${precedent.addedOn.toLocaleDateString("en-KE")}, never reviewed`
              : `checked ${lastVerified(precedent).toLocaleDateString("en-KE")}`}
            {precedent.note === undefined ? null : ` · ${precedent.note}`}
          </div>
        </div>
      ))}
    </>
  );
}
