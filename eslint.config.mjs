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
 *
 * The table itself is in `eslint.boundaries.mjs`, because `architecture.test.ts`
 * reads it too — see there for why the diagram is checked against the rules
 * rather than against a copy of them.
 */
import { layerBoundaries } from "./eslint.boundaries.mjs";

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
