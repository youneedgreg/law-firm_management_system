import Link from "next/link";
import { Effect } from "effect";
import { Empty, SectionTitle } from "@/components/ui";
import { runAs } from "@/runtime/session";
import { type Hit, type Kind } from "@/services/search";
import { MINIMUM_TERM, SearchService } from "@/services/search-service";

/**
 * Search results.
 *
 * A page rather than a dropdown under the box, and that is a deliberate trade.
 * A type-ahead panel is nicer for the case where the first hit is the right one
 * and worse for every other: it cannot be linked, it cannot be read at leisure,
 * it disappears when the mouse moves, and it needs a request per keystroke
 * against four tables. A URL that says `/search?q=zenith` is something somebody
 * can send to a colleague.
 *
 * The term lives in the query string for the same reason the caseload's status
 * filter does: a search is a *place*.
 *
 * ## What is deliberately absent
 *
 * There is no permission check here and no scoping. `SearchService` decides
 * which kinds to query and narrows every one of them to the caller's scope
 * before a row is read; a second copy of either rule in this file would be a
 * second copy to forget. What this page does is say **what was searched**, so
 * a Receptionist who finds nothing knows the fee notes were never looked at
 * rather than assuming there were none.
 *
 * ## A portal user cannot reach this route, and the service is scoped anyway
 *
 * `proxy.ts` redirects a client off every internal route, this one included, so
 * in practice only staff arrive here. `SearchService` still narrows to the
 * caller's scope, and there are tests for the portal case that no route
 * currently exercises.
 *
 * That is not the same as a permission granted before its operation exists —
 * the criticism this phase has levelled at several things and acted on. Scope
 * is enforced at the *service* boundary throughout this system, deliberately,
 * because the route tree is an affordance and the service is the rule. A
 * `find` that behaved correctly only because the router happened not to send it
 * a client would be wrong the day somebody adds a portal search, and would be
 * wrong quietly.
 */

const ICON: Readonly<Record<Kind, string>> = {
  Matter: "ph-duotone ph-briefcase",
  Client: "ph-duotone ph-users",
  Document: "ph-duotone ph-folder",
  Invoice: "ph-duotone ph-receipt",
};

export default async function SearchPage({
  searchParams,
}: PageProps<"/search">) {
  const { q } = await searchParams;
  const term = typeof q === "string" ? q : "";

  const results = await runAs(
    Effect.flatMap(SearchService, (service) => service.find(term)),
  );

  const byKind = (kind: Kind) =>
    results.hits.filter((hit) => hit.kind === kind);

  return (
    <>
      <h1 className="page-title">Search</h1>

      {results.tooShort ? (
        <p className="page-subtitle">
          Type at least {MINIMUM_TERM} characters. A shorter term matches most
          of the firm, which is slower than it is useful.
        </p>
      ) : (
        <p className="page-subtitle">
          {results.hits.length === 0
            ? "Nothing matched "
            : `${String(results.hits.length)} ${
                results.hits.length === 1 ? "result" : "results"
              } for `}
          <strong>{results.term}</strong>
          {/*
            Saying what was searched matters as much as the results. A
            Receptionist holds no `invoice:read`, so fee notes were never
            queried — and without this line an empty list reads as "the firm
            has no such invoice" rather than "you cannot see invoices".
          */}
          {results.searched.length > 0 ? (
            <span className="dek">
              {" "}
              · searched {results.searched.join(", ").toLowerCase()}
            </span>
          ) : null}
        </p>
      )}

      {!results.tooShort && results.hits.length === 0 ? (
        <Empty>
          Nothing on file matches that. Matters can also be found by the party
          on the other side, and clients by their reference or email.
        </Empty>
      ) : null}

      {(["Matter", "Client", "Document", "Invoice"] as const).map((kind) => {
        const hits = byKind(kind);
        if (hits.length === 0) return null;

        return (
          <section key={kind} style={{ marginBottom: "var(--space-5)" }}>
            <SectionTitle>
              {kind === "Matter" ? "Matters" : `${kind}s`}
            </SectionTitle>
            {hits.map((hit) => (
              <Result key={`${hit.kind}-${hit.href}`} hit={hit} />
            ))}
          </section>
        );
      })}
    </>
  );
}

function Result({ hit }: { hit: Hit }) {
  return (
    <Link
      href={hit.href}
      className="row row-icon"
      style={{ color: "inherit", textDecoration: "none" }}
    >
      <i className={ICON[hit.kind]} aria-hidden />
      <div>
        <div className="row-title">
          {hit.title}
          {hit.reference === "" ? null : (
            <span className="dek"> · {hit.reference}</span>
          )}
        </div>
        {hit.detail === "" ? null : (
          <div className="row-meta">{hit.detail}</div>
        )}
      </div>
    </Link>
  );
}
