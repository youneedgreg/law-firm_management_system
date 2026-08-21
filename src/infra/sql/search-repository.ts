import { SqlClient } from "@effect/sql";
import { Effect, Layer } from "effect";
import {
  type Hit,
  type Kind,
  SearchRepository,
  type VisibleTo,
} from "../../services/search";
import { failure } from "./failure";

/**
 * Global search, in Postgres.
 *
 * ## The scope is inside every query
 *
 * Each statement below carries `(${visibleTo}::uuid IS NULL OR <column> =
 * ${visibleTo})`. That is deliberately not a `WHERE` the caller adds: it is
 * part of the query text, so there is no version of these functions that
 * searches unscoped, and a portal user's search is narrowed before a single row
 * is read rather than after.
 *
 * The `IS NULL` branch is what lets one statement serve both cases without a
 * second query to keep in step. It reads as a hole and is not one: `visibleTo`
 * is `ClientId | undefined` in TypeScript, so the only way to reach that branch
 * is to be entitled to the whole firm.
 *
 * ## Ranking happens in SQL because `LIMIT` does
 *
 * An exact identifier beats a prefix, a prefix beats a substring. Sorting in
 * the application would sort a list the database had already truncated, which
 * puts the best match on the page nobody looks at.
 */

/** Escapes the characters `LIKE` treats as wildcards. */
const literal = (term: string): string =>
  term.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");

const hit =
  (kind: Kind, route: (id: string) => string) =>
  (row: {
    id: string;
    reference: string;
    title: string;
    detail: string | null;
    rank: string | number;
  }): Hit => ({
    kind,
    href: route(row.id),
    reference: row.reference,
    title: row.title,
    detail: row.detail ?? "",
    rank: Number(row.rank),
  });

interface Row {
  id: string;
  reference: string;
  title: string;
  detail: string | null;
  rank: string | number;
}

export const SearchRepositoryLive = Layer.effect(
  SearchRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    /**
     * `%term%`, `term%` and `term` — the three shapes the ranking distinguishes.
     *
     * Built once per search rather than inlined three times, so the escaping
     * cannot be applied to one and forgotten on another.
     */
    const patterns = (term: string) => {
      const safe = literal(term.trim());
      return { exact: safe, prefix: `${safe}%`, anywhere: `%${safe}%` };
    };

    return SearchRepository.of({
      matters: (term, visibleTo: VisibleTo, limit) => {
        const { exact, prefix, anywhere } = patterns(term);

        return sql<Row>`
          SELECT c.id,
                 c.number AS reference,
                 c.title,
                 cl.name AS detail,
                 CASE
                   WHEN c.number ILIKE ${exact} THEN 3
                   WHEN c.number ILIKE ${prefix}
                     OR c.cause_number ILIKE ${prefix} THEN 2
                   WHEN c.title ILIKE ${anywhere} THEN 1
                   ELSE 0
                 END AS rank
            FROM cases c
            JOIN clients cl ON cl.id = c.client_id
           WHERE (${visibleTo ?? null}::uuid IS NULL
                  OR c.client_id = ${visibleTo ?? null}::uuid)
             AND (
               c.number ILIKE ${anywhere}
               OR c.title ILIKE ${anywhere}
               OR c.cause_number ILIKE ${anywhere}
               -- The one worth having: "who else have we acted against" is
               -- how a conflict gets noticed by somebody who is not running a
               -- formal screen. opposing_parties is the column the conflict
               -- module needed before it could run at all.
               OR EXISTS (
                 SELECT 1 FROM unnest(c.opposing_parties) AS party
                  WHERE party ILIKE ${anywhere}
               )
             )
           ORDER BY rank DESC, c.number
           LIMIT ${limit}
        `.pipe(
          Effect.map((rows) => rows.map(hit("Matter", (id) => `/cases/${id}`))),
          Effect.mapError(failure("searchMatters")),
        );
      },

      clients: (term, visibleTo: VisibleTo, limit) => {
        const { exact, prefix, anywhere } = patterns(term);

        return sql<Row>`
          SELECT c.id,
                 c.number AS reference,
                 c.name AS title,
                 c.email AS detail,
                 CASE
                   WHEN c.number ILIKE ${exact} THEN 3
                   WHEN c.name ILIKE ${prefix} THEN 2
                   WHEN c.name ILIKE ${anywhere} THEN 1
                   ELSE 0
                 END AS rank
            FROM clients c
           WHERE (${visibleTo ?? null}::uuid IS NULL
                  OR c.id = ${visibleTo ?? null}::uuid)
             AND (
               c.name ILIKE ${anywhere}
               OR c.number ILIKE ${anywhere}
               OR c.email ILIKE ${anywhere}
             )
           ORDER BY rank DESC, c.name
           LIMIT ${limit}
        `.pipe(
          Effect.map((rows) =>
            rows.map(hit("Client", (id) => `/clients/${id}`)),
          ),
          Effect.mapError(failure("searchClients")),
        );
      },

      /**
       * Documents are scoped **through their matter**, which is the join a
       * one-query search would have got wrong.
       *
       * `documents` has no `client_id`; it has a `case_id`, and the client is
       * one hop further. A filter applied to the results rather than the query
       * would have had to remember that hop, and the version that forgets it
       * returns every document in the firm.
       */
      documents: (term, visibleTo: VisibleTo, limit) => {
        const { prefix, anywhere } = patterns(term);

        return sql<Row>`
          SELECT d.id,
                 c.number AS reference,
                 d.name AS title,
                 c.title AS detail,
                 CASE
                   WHEN d.name ILIKE ${prefix} THEN 2
                   WHEN d.name ILIKE ${anywhere} THEN 1
                   ELSE 0
                 END AS rank
            FROM documents d
            JOIN cases c ON c.id = d.case_id
           WHERE (${visibleTo ?? null}::uuid IS NULL
                  OR c.client_id = ${visibleTo ?? null}::uuid)
             AND d.name ILIKE ${anywhere}
           ORDER BY rank DESC, d.name
           LIMIT ${limit}
        `.pipe(
          Effect.map((rows) =>
            rows.map(hit("Document", (id) => `/documents/${id}`)),
          ),
          Effect.mapError(failure("searchDocuments")),
        );
      },

      invoices: (term, visibleTo: VisibleTo, limit) => {
        const { exact, prefix, anywhere } = patterns(term);

        return sql<Row>`
          SELECT i.id,
                 i.number AS reference,
                 cl.name AS title,
                 to_char(i.issued_on, 'DD Mon YYYY') AS detail,
                 CASE
                   WHEN i.number ILIKE ${exact} THEN 3
                   WHEN i.number ILIKE ${prefix} THEN 2
                   ELSE 1
                 END AS rank
            FROM invoices i
            JOIN clients cl ON cl.id = i.client_id
           WHERE (${visibleTo ?? null}::uuid IS NULL
                  OR i.client_id = ${visibleTo ?? null}::uuid)
             AND (i.number ILIKE ${anywhere} OR cl.name ILIKE ${anywhere})
           ORDER BY rank DESC, i.number
           LIMIT ${limit}
        `.pipe(
          Effect.map((rows) =>
            rows.map(hit("Invoice", (id) => `/billing/invoices/${id}`)),
          ),
          Effect.mapError(failure("searchInvoices")),
        );
      },
    });
  }),
);
