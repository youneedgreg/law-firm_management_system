import { Context, type Effect } from "effect";
import type { ClientId } from "../domain/shared/ids";
import type { RepositoryFailure } from "./repositories";

/**
 * Global search.
 *
 * ## This is the endpoint most likely to leak, and the design says so
 *
 * Every other read in this system is about one kind of thing and is scoped
 * where it is written. Search spans five tables at once, and the tempting
 * implementation — one `UNION ALL` over everything, filtered afterwards — is
 * the shape that puts another client's matter in front of a portal user the
 * first time somebody forgets a `WHERE`.
 *
 * So the scope is a **parameter of every query**, not a filter applied to the
 * results. `visibleTo` is required, not optional, and there is no overload
 * without it: a caller cannot search "everything" by omitting an argument,
 * because the argument has no default. That is the same reasoning as
 * `CurrentUser` sitting in the `R` channel of every service operation —
 * forgetting has to be a compile error rather than a code review.
 *
 * ## Why not full-text search
 *
 * Postgres `tsvector` is built for prose and this is not prose. People search a
 * law firm's system for **identifiers**: `OKL-2026-014`, `INV-3002`, `HCCOMM
 * E0091 of 2026`. A text-search configuration tokenises those into pieces that
 * do not match what was typed, and stemming actively harms a name — `Wanjiku`
 * and `Wanjiru` are different people and no stemmer should be encouraged to
 * think otherwise.
 *
 * `ILIKE` against indexed columns, ranked so that an exact identifier beats a
 * prefix and a prefix beats a substring, is both simpler and better suited.
 * Fuzzy matching for genuine typos would want `pg_trgm`, which is a real
 * improvement and a separate decision: it needs an extension, an index per
 * column and a similarity threshold somebody has to choose, and none of that is
 * worth doing before anybody has complained about a missed spelling.
 */

export const KINDS = ["Matter", "Client", "Document", "Invoice"] as const;

export type Kind = (typeof KINDS)[number];

/**
 * One hit.
 *
 * Deliberately flat and stringly-typed rather than a union of entity shapes.
 * A result list renders the same four fields for every kind, and a union would
 * mean four branches in the screen to produce identical markup — with the
 * screen then deciding what a matter's subtitle is, which is not its business.
 */
export interface Hit {
  readonly kind: Kind;
  /** Where to go. Already a route, so the screen makes no decisions. */
  readonly href: string;
  /** The identifier a person recognises: `OKL-2026-014`, `CLT-1001`. */
  readonly reference: string;
  readonly title: string;
  /** One line of context — the client on a matter, the matter on a document. */
  readonly detail: string;
  /**
   * How well it matched, 0 to 3.
   *
   * Ranked in SQL rather than sorted in the application, because the ordering
   * has to be applied *before* the `LIMIT` — sorting a truncated list puts the
   * best match on page two.
   */
  readonly rank: number;
}

/**
 * Who may see what, resolved from the caller's scope before any query runs.
 *
 * `WholeFirm` is `undefined` rather than a sentinel string: an accidental
 * `visibleTo: ""` would then be a type error rather than a silent grant.
 */
export type VisibleTo = ClientId | undefined;

export interface SearchRepository {
  /**
   * Matters matching `term`, within scope.
   *
   * Searches the number, the title, the cause number and the opposing parties.
   * The last of those is the one worth having: "who else have we acted
   * against" is how a conflict is noticed by somebody who is not running a
   * formal screen.
   */
  readonly matters: (
    term: string,
    visibleTo: VisibleTo,
    limit: number,
  ) => Effect.Effect<readonly Hit[], RepositoryFailure>;

  readonly clients: (
    term: string,
    visibleTo: VisibleTo,
    limit: number,
  ) => Effect.Effect<readonly Hit[], RepositoryFailure>;

  readonly documents: (
    term: string,
    visibleTo: VisibleTo,
    limit: number,
  ) => Effect.Effect<readonly Hit[], RepositoryFailure>;

  readonly invoices: (
    term: string,
    visibleTo: VisibleTo,
    limit: number,
  ) => Effect.Effect<readonly Hit[], RepositoryFailure>;
}

export const SearchRepository =
  Context.GenericTag<SearchRepository>("SearchRepository");
