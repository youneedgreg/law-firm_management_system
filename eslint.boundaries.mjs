/**
 * The architecture boundaries, as data (ROADMAP.md §4).
 *
 * In their own module, imported by `eslint.config.mjs` and by
 * `src/architecture.test.ts`. The linter is what *enforces* the layering; the
 * test is what stops `docs/architecture.md` from drawing an arrow the linter
 * forbids. Both need the same table, and a diagram checked against a copy of
 * the rules would be a diagram checked against nothing.
 */

/**
 * Patterns are written four ways, because `no-restricted-imports` matches the
 * import *string* rather than the file it resolves to.
 *
 * - `@/dir/*` and `@/dir` — the alias, with and without a path after it.
 * - `**​/dir/**` — the relative form, `../../lib/data/clients`. Blocking only
 *   the alias leaves this wide open, and it is exactly what somebody reaches
 *   for when the alias is refused.
 * - `**​/dir` — the relative form of a *directory* import, `../runtime`, which
 *   resolves to its `index.ts`. This one was missing until Phase 4 added
 *   `src/api/` and a probe walked straight through the new rule: `../runtime`
 *   matches neither `@/runtime` nor `**​/runtime/**`. Every boundary declared
 *   here had the same hole, and only `runtime/` and `api/` have an index for it
 *   to be exploited through today.
 */
export const layer = (dir) => [
  `@/${dir}/*`,
  `@/${dir}`,
  `**/${dir}/**`,
  `**/${dir}`,
];

export const layerBoundaries = [
  {
    name: "domain",
    files: ["src/domain/**/*.ts", "src/domain/**/*.tsx"],
    forbidden: [
      ...layer("services"),
      ...layer("infra"),
      ...layer("api"),
      ...layer("app"),
      ...layer("components"),
      ...layer("runtime"),
      ...layer("lib"),
    ],
    because:
      "domain/ must stay pure: no I/O, no framework, no knowledge of how it is stored or served. It imports nothing else in src/.",
  },
  {
    name: "services",
    files: ["src/services/**/*.ts"],
    forbidden: [
      ...layer("infra"),
      ...layer("app"),
      ...layer("components"),
      ...layer("lib"),
    ],
    because:
      "services/ depends on repository interfaces it declares, never on a concrete implementation or on UI helpers.",
  },
  {
    name: "infra",
    files: ["src/infra/**/*.ts"],
    forbidden: [...layer("app"), ...layer("components")],
    because:
      "infra/ is a leaf: it implements interfaces, it does not call into the UI.",
  },
  {
    name: "runtime",
    files: ["src/runtime/**/*.ts"],
    forbidden: [...layer("app"), ...layer("components")],
    because:
      "runtime/ is where services meet their implementations. It is imported by the UI and imports none of it — a Layer that reached for a component would make the wiring un-runnable outside a request.",
  },
  {
    name: "api",
    files: ["src/api/**/*.ts"],
    forbidden: [
      ...layer("infra"),
      ...layer("app"),
      ...layer("components"),
      ...layer("lib"),
    ],
    because:
      "api/ is a delivery adapter: it calls services and is wired to their implementations by runtime/. A handler that reached for a repository would be application logic living in the transport, and the next delivery mechanism would need its own copy of it.",
  },
  {
    /**
     * The browser's half of the application, and the mirror image of
     * `runtime/`: atoms, the Layer they are built from, and the React bindings
     * for reading them.
     *
     * It may reach the shared half of `api/` — that is the whole point, the
     * atoms call the generated client — and `domain/` and `lib/` for the types
     * the screens are written against. It may not reach `infra/` or `runtime/`,
     * which are Postgres, and a single import of either would put the driver in
     * the browser bundle. It may not reach `app/` or `components/` either: the
     * dependency runs the other way, and an atom that imported a screen would
     * be a state layer that could not be tested without one.
     */
    name: "rx (the browser's runtime)",
    files: ["src/rx/**/*.ts", "src/rx/**/*.tsx"],
    forbidden: [
      ...layer("infra"),
      ...layer("runtime"),
      ...layer("app"),
      ...layer("components"),
    ],
    because:
      "rx/ is the browser's composition root. It calls the API over the contract and knows nothing about how the server answers — a Postgres import here would be a driver in the client bundle, and a component import would invert the dependency the whole layering rests on.",
  },
  /**
   * The contract is held by both ends, so it has to survive being imported
   * into a browser bundle — Phase 5 derives the client from it. `runtime/`
   * reaches Postgres, so a single import of it anywhere in this list would
   * put the driver in the client bundle, and the failure arrives as an
   * inscrutable build error rather than as a boundary violation.
   *
   * `server.ts`, `openapi.ts` and `handlers/` are deliberately not listed:
   * they are the server half, and the whole point is that the line runs
   * between them and these.
   *
   * Listed by name rather than by a glob, because a glob would silently take
   * in whatever is added next — and whether a new file belongs to the shared
   * half is a decision, not a default.
   */
  {
    name: "api contract (shared with the browser)",
    files: [
      "src/api/wire.ts",
      "src/api/responses.ts",
      "src/api/failures.ts",
      "src/api/contract.ts",
      "src/api/client.ts",
      /**
       * Phase 6 added the authentication middleware's *definition* to the
       * shared half. The contract carries it — every endpoint declares 401 —
       * so the browser's generated client imports it. Its implementation is
       * `handlers/authentication.ts`, which is the server half and is not
       * listed here.
       */
      "src/api/authentication.ts",
    ],
    forbidden: [
      ...layer("infra"),
      ...layer("runtime"),
      ...layer("app"),
      ...layer("components"),
      ...layer("lib"),
    ],
    because:
      "This half of api/ is the shared contract. It is imported by the browser, so it may reach domain/ and services/ and nothing that touches a database.",
  },
];
