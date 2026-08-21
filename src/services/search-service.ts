import { Effect } from "effect";
import { may, type NotPermitted } from "../domain/identity/permissions";
import { type CurrentUser, permitted, scope } from "./policy";
import type { RepositoryFailure } from "./repositories";
import { type Hit, type Kind, SearchRepository } from "./search";

/**
 * Search across the firm, bounded by who is asking.
 *
 * ## Two independent limits, and both are needed
 *
 * **Permission** decides which *kinds* are searched at all. A Receptionist
 * holds no `invoice:read`, so fee notes are not queried — not filtered out
 * afterwards, not queried. A search that ran the query and dropped the rows
 * would still have read them, and the next person to add a debug log would
 * print them.
 *
 * **Scope** decides which *rows* within a kind. It travels into every query as
 * a parameter rather than being applied to results; see `search-repository.ts`
 * for why that distinction is the whole design here.
 *
 * Neither alone is sufficient and the failure modes differ. Without the
 * permission check a Receptionist searching "Zenith" learns what the firm has
 * billed them. Without the scope check a portal user searching their own name
 * finds every other client with a similar one.
 *
 * ## Why one short search per kind rather than one long one
 *
 * Each kind gets its own `LIMIT`, so a client with two hundred documents cannot
 * push every matter off the results. A single ranked query over a union would
 * be one round trip and would do exactly that — the commonest kind wins, and
 * search becomes useless for everything else.
 */

/** Per kind, so no single kind can crowd out the others. */
const PER_KIND = 5;

/**
 * The shortest term worth running.
 *
 * Two characters against `%term%` on four tables is a scan that returns most
 * of the firm, which is slow *and* useless. Below this the answer is "keep
 * typing" rather than a list.
 */
export const MINIMUM_TERM = 2;

export interface Results {
  readonly term: string;
  readonly hits: readonly Hit[];
  /** Kinds actually searched, so the screen can say what it did not look at. */
  readonly searched: readonly Kind[];
  /** True when the term was too short to run. */
  readonly tooShort: boolean;
}

export class SearchService extends Effect.Service<SearchService>()(
  "SearchService",
  {
    effect: Effect.gen(function* () {
      const search = yield* SearchRepository;

      return {
        find: (
          raw: string,
        ): Effect.Effect<
          Results,
          NotPermitted | RepositoryFailure,
          CurrentUser
        > =>
          Effect.gen(function* () {
            /**
             * Gated on `case:read`, the one permission every principal in the
             * system holds — staff and portal user alike. It is not doing the
             * work here; the per-kind checks below are. It is here so that
             * search is not reachable by something with no permissions at all.
             */
            const principal = yield* permitted("case:read");
            const visible = yield* scope;

            const term = raw.trim();

            if (term.length < MINIMUM_TERM) {
              return { term, hits: [], searched: [], tooShort: true };
            }

            /**
             * The scope, as the repository wants it: a client id, or nothing
             * for the whole firm. Resolved once, here, so no query below can
             * disagree about who is asking.
             */
            const visibleTo =
              visible._tag === "WholeFirm" ? undefined : visible.clientId;

            /**
             * Which kinds this caller may search at all.
             *
             * Matters and clients need `case:read` and `client:read`, which
             * every principal holds — a portal user's copy of both is scoped
             * to themselves. Documents and fee notes are the two that differ
             * between roles.
             */
            const kinds: readonly Kind[] = [
              ...(may(principal, "case:read") ? (["Matter"] as const) : []),
              ...(may(principal, "client:read") ? (["Client"] as const) : []),
              ...(may(principal, "document:read")
                ? (["Document"] as const)
                : []),
              ...(may(principal, "invoice:read") ? (["Invoice"] as const) : []),
            ];

            const [matters, clients, documents, invoices] = yield* Effect.all(
              [
                kinds.includes("Matter")
                  ? search.matters(term, visibleTo, PER_KIND)
                  : Effect.succeed<readonly Hit[]>([]),
                kinds.includes("Client")
                  ? search.clients(term, visibleTo, PER_KIND)
                  : Effect.succeed<readonly Hit[]>([]),
                kinds.includes("Document")
                  ? search.documents(term, visibleTo, PER_KIND)
                  : Effect.succeed<readonly Hit[]>([]),
                kinds.includes("Invoice")
                  ? search.invoices(term, visibleTo, PER_KIND)
                  : Effect.succeed<readonly Hit[]>([]),
              ],
              { concurrency: "unbounded" },
            );

            /**
             * Best match first, then by kind in a fixed order.
             *
             * The tie-break is `KINDS` order rather than alphabetical, because
             * it encodes what somebody searching a law firm's system is most
             * likely to want: a matter, then the client, then the paperwork.
             * Two hits of equal rank are genuinely equally good matches, and
             * the order between them is a judgement rather than a fact.
             */
            const order = new Map(KIND_ORDER.map((kind, at) => [kind, at]));

            const hits = [
              ...matters,
              ...clients,
              ...documents,
              ...invoices,
            ].sort(
              (a, b) =>
                b.rank - a.rank ||
                (order.get(a.kind) ?? 0) - (order.get(b.kind) ?? 0) ||
                a.reference.localeCompare(b.reference),
            );

            return { term, hits, searched: kinds, tooShort: false };
          }),
      };
    }),
  },
) {}

const KIND_ORDER: readonly Kind[] = ["Matter", "Client", "Document", "Invoice"];
