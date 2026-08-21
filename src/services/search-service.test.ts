import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import {
  asAdvocate,
  asFinance,
  asReceptionist,
  asWanjiku,
  asZenith,
  clients,
  documents,
  filedMatter,
  invoices,
  matters,
  unfiledMatter,
  wanjiku,
  zenith,
} from "../../test/fixtures";
import { inMemorySearch } from "../../test/in-memory-repositories";
import type { Principal } from "../domain/identity/principal";
import { CurrentUser } from "./policy";
import { MINIMUM_TERM, SearchService } from "./search-service";

/**
 * `SearchService`, and the two independent limits it applies.
 *
 * Search spans every table at once, which makes it the endpoint most likely to
 * leak. **Permission** decides which kinds are searched at all; **scope**
 * decides which rows within a kind. Neither alone is enough, and the failure
 * modes differ: without the permission a Receptionist searching a client's name
 * learns what the firm has billed them; without the scope a portal user
 * searching their own name finds every other client with a similar one.
 */

const firm = SearchService.Default.pipe(
  Layer.provideMerge(inMemorySearch({ matters, clients, documents, invoices })),
);

const searchAs = (principal: Principal, term: string) =>
  Effect.flatMap(SearchService, (service) => service.find(term)).pipe(
    Effect.provideService(CurrentUser, principal),
  );

const run = <A, E>(body: Effect.Effect<A, E, SearchService>) =>
  body.pipe(Effect.provide(firm));

describe("finding things", () => {
  it.effect("finds a matter by its reference", () =>
    run(
      Effect.gen(function* () {
        const results = yield* searchAs(asAdvocate, filedMatter.number);

        expect(results.hits.map((hit) => hit.reference)).toContain(
          filedMatter.number,
        );
        expect(results.hits[0]?.kind).toBe("Matter");
      }),
    ),
  );

  it.effect("finds a matter by words in its title", () =>
    run(
      Effect.gen(function* () {
        const word = filedMatter.title.split(" ")[0] ?? "";
        const results = yield* searchAs(asAdvocate, word);

        expect(results.hits.length).toBeGreaterThan(0);
      }),
    ),
  );

  /**
   * The one worth having. "Who else have we acted against" is how a conflict
   * gets noticed by somebody not running a formal screen — and `opposingParties`
   * is the column the conflict module needed before it could run at all.
   */
  it.effect("finds a matter by who it is against", () =>
    run(
      Effect.gen(function* () {
        const party = filedMatter.opposingParties[0];
        expect(party).toBeDefined();

        const results = yield* searchAs(asAdvocate, party!);

        expect(results.hits.map((hit) => hit.reference)).toContain(
          filedMatter.number,
        );
      }),
    ),
  );

  it.effect("puts the best match first", () =>
    run(
      Effect.gen(function* () {
        const results = yield* searchAs(asAdvocate, filedMatter.number);
        const ranks = results.hits.map((hit) => hit.rank);

        expect(ranks).toStrictEqual([...ranks].sort((a, b) => b - a));
      }),
    ),
  );

  it.effect("gives every hit somewhere to go", () =>
    run(
      Effect.gen(function* () {
        const results = yield* searchAs(asAdvocate, "OKL");

        expect(results.hits.length).toBeGreaterThan(0);
        for (const hit of results.hits) {
          expect(hit.href.startsWith("/")).toBe(true);
        }
      }),
    ),
  );
});

describe("a term too short to run", () => {
  /**
   * Two characters against `%term%` on four tables returns most of the firm,
   * which is slow *and* useless. Below the minimum the answer is "keep typing"
   * rather than a list — and saying so explicitly beats an empty result, which
   * reads as "nothing found".
   */
  it.effect("says so rather than returning nothing", () =>
    run(
      Effect.gen(function* () {
        const results = yield* searchAs(asAdvocate, "a");

        expect(results.tooShort).toBe(true);
        expect(results.hits).toStrictEqual([]);
        expect(results.searched).toStrictEqual([]);
      }),
    ),
  );

  it.effect("runs at the minimum length", () =>
    run(
      Effect.gen(function* () {
        const results = yield* searchAs(
          asAdvocate,
          "OK".slice(0, MINIMUM_TERM),
        );

        expect(results.tooShort).toBe(false);
      }),
    ),
  );

  it.effect("treats whitespace as nothing typed", () =>
    run(
      Effect.gen(function* () {
        const results = yield* searchAs(asAdvocate, "   ");

        expect(results.tooShort).toBe(true);
      }),
    ),
  );
});

describe("which kinds are searched", () => {
  it.effect("gives an advocate every kind", () =>
    run(
      Effect.gen(function* () {
        const results = yield* searchAs(asAdvocate, "OKL");

        expect(results.searched).toStrictEqual([
          "Matter",
          "Client",
          "Document",
          "Invoice",
        ]);
      }),
    ),
  );

  /**
   * **Not queried, not filtered.** A search that ran the invoice query and
   * dropped the rows would still have read them, and the next person to add a
   * debug log would print them.
   */
  it.effect("does not search fee notes or documents for a Receptionist", () =>
    run(
      Effect.gen(function* () {
        const results = yield* searchAs(asReceptionist, "OKL");

        expect(results.searched).not.toContain("Invoice");
        expect(results.searched).not.toContain("Document");
        expect(results.hits.map((hit) => hit.kind)).not.toContain("Invoice");
      }),
    ),
  );

  /** Finance holds `invoice:read` and no `document:read`. */
  it.effect("gives a Finance Officer fee notes and not documents", () =>
    run(
      Effect.gen(function* () {
        const results = yield* searchAs(asFinance, "OKL");

        expect(results.searched).toContain("Invoice");
        expect(results.searched).not.toContain("Document");
      }),
    ),
  );
});

describe("scope", () => {
  /**
   * **The test this endpoint exists to pass.**
   *
   * Wanjiku searches a term matching Zenith's matter as well as her own, and
   * gets only hers. The fake applies the scope too, so this fails if
   * `SearchService` stops passing it down — rather than passing because a stub
   * returned nothing.
   */
  it.effect("does not let a portal user find another client's matter", () =>
    run(
      Effect.gen(function* () {
        const results = yield* searchAs(asWanjiku, "OKL");
        const references = results.hits.map((hit) => hit.reference);

        expect(references).toContain(filedMatter.number);
        expect(references).not.toContain(unfiledMatter.number);
      }),
    ),
  );

  it.effect("does not let a portal user find another client", () =>
    run(
      Effect.gen(function* () {
        const results = yield* searchAs(asWanjiku, zenith.name.slice(0, 4));

        expect(results.hits.map((hit) => hit.title)).not.toContain(zenith.name);
      }),
    ),
  );

  it.effect("does let a portal user find themselves", () =>
    run(
      Effect.gen(function* () {
        const results = yield* searchAs(asWanjiku, wanjiku.name.slice(0, 6));

        expect(results.hits.map((hit) => hit.title)).toContain(wanjiku.name);
      }),
    ),
  );

  /** The mirror image, so the scope is not accidentally fixed to one client. */
  it.effect("scopes a different portal user to their own file", () =>
    run(
      Effect.gen(function* () {
        const results = yield* searchAs(asZenith, "OKL");
        const references = results.hits.map((hit) => hit.reference);

        expect(references).toContain(unfiledMatter.number);
        expect(references).not.toContain(filedMatter.number);
      }),
    ),
  );

  /**
   * Documents are scoped *through their matter* — the join a one-query search
   * would have got wrong, because `documents` carries a `case_id` and not a
   * `client_id`.
   */
  it.effect(
    "does not let a portal user find a document on another's matter",
    () =>
      run(
        Effect.gen(function* () {
          const results = yield* searchAs(asZenith, "Plaint");

          expect(results.hits.map((hit) => hit.kind)).not.toContain("Document");
        }),
      ),
  );

  it.effect("gives staff the whole firm", () =>
    run(
      Effect.gen(function* () {
        const results = yield* searchAs(asAdvocate, "OKL");
        const references = results.hits.map((hit) => hit.reference);

        expect(references).toContain(filedMatter.number);
        expect(references).toContain(unfiledMatter.number);
      }),
    ),
  );
});
