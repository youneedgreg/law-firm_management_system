import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Architecture boundaries (ROADMAP.md §4).
 *
 * Dependencies point inward: domain knows nothing, services know domain,
 * infra implements what services declare, app wires it together. These rules
 * are what stop that from decaying into a suggestion — a layering violation
 * fails CI rather than surviving review.
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
const layer = (dir) => [`@/${dir}/*`, `@/${dir}`, `**/${dir}/**`, `**/${dir}`];

const layerBoundaries = [
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

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  ...layerBoundaries.map(({ files, forbidden, because }) => ({
    files,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [{ group: forbidden, message: because }],
        },
      ],
    },
  })),

  {
    // Seed data is a Phase 0-2 scaffold. Once repositories land, routes read
    // from services instead and this rule flips to "error" to catch strays.
    files: ["src/app/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "warn",
        {
          patterns: [
            {
              group: ["@/lib/data/*"],
              message:
                "Mock seed data. Replace with a service call as each module migrates (ROADMAP Phase 7).",
            },
          ],
        },
      ],
    },
  },

  {
    /**
     * Restores the rule's own default for the one pattern this codebase uses
     * it for: naming a prop in order to *drop* it.
     *
     * `const { pattern, ...select } = props` is how a component says "this one
     * is not forwarded" — `SelectField` does it for the text-input constraints
     * a `<select>` cannot honour. `eslint-config-next` turns
     * `ignoreRestSiblings` off, which reports every such prop as unused, and
     * the alternative to naming them is deleting keys off a spread and losing
     * the types that make the omission checkable.
     *
     * It only applies where there is a rest element, so it cannot hide an
     * ordinary unused variable.
     */
    files: ["src/**/*.ts", "src/**/*.tsx"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { ignoreRestSiblings: true, argsIgnorePattern: "^_" },
      ],
    },
  },

  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Ours:
    "coverage/**",
    "design/**",
  ]),
]);

export default eslintConfig;
