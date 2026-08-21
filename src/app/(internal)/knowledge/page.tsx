import { Effect } from "effect";
import { SectionTitle } from "@/components/ui";
import { runAs } from "@/runtime/session";
import { LibraryService } from "@/services/library-service";
import { KnowledgeSearch } from "./KnowledgeSearch";

/**
 * The precedent bank, read from Postgres.
 *
 * ## The list at the top is what makes a bank trustworthy
 *
 * Not what is in it — **what in it should not be relied on without a second
 * look**. A precedent bank's failure mode is not being empty, it is being
 * stale: an annotated Employment Act from 2019 looks exactly like a current one
 * in a list of titles, and somebody drafts from it. Every entry records when it
 * was last checked against the law, and `needsReview` follows from that.
 *
 * A year is the interval, and the reason is local: Kenya passes a Finance Act
 * annually, and it moves the ground under any tax precedent in the bank.
 *
 * ## Searching happens in the browser, on purpose
 *
 * The whole bank is sent once and filtered as you type. A firm's bank is tens
 * of entries; a round trip per keystroke to narrow forty rows is the wrong
 * trade, and the matching rule lives in the domain where it is tested rather
 * than in an `ILIKE`. Global search across every matter, client and document is
 * a different problem with thousands of rows, and it gets a different answer.
 */
export default async function KnowledgePage() {
  const bank = await runAs(
    Effect.flatMap(LibraryService, (service) => service.bank()),
  );

  return (
    <>
      <h1 className="page-title">Legal Research &amp; Knowledge Base</h1>
      <p className="page-subtitle">
        Acts, case law, templates and the firm&rsquo;s own precedent bank
        &mdash; with the date each was last checked against the law.
      </p>

      {bank.stale.length > 0 ? (
        <section style={{ marginBottom: "var(--space-6)" }}>
          <SectionTitle>Check these before relying on them</SectionTitle>
          <p className="dek" style={{ marginBottom: "var(--space-2)" }}>
            Nobody has verified {bank.stale.length === 1 ? "this" : "these"}{" "}
            against current law in over a year. Kenya passes a Finance Act
            annually; an unchecked tax precedent is the one that catches people.
          </p>
          {bank.stale.map((precedent) => (
            <div className="row row-icon" key={precedent.id}>
              <i className="ph-duotone ph-warning ink-accent-2" aria-hidden />
              <div>
                <div className="row-title">{precedent.title}</div>
                <div className="row-meta">
                  {precedent.category} · {precedent.location} ·{" "}
                  {precedent.reviewedOn._tag === "None"
                    ? `never reviewed — filed ${precedent.addedOn.toLocaleDateString("en-KE")}`
                    : `last checked ${precedent.reviewedOn.value.toLocaleDateString("en-KE")}`}
                </div>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      <SectionTitle spaced>The bank</SectionTitle>
      <KnowledgeSearch bank={bank.precedents} asAt={bank.asAt} />
    </>
  );
}
