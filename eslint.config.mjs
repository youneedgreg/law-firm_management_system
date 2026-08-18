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
const layerBoundaries = [
  {
    name: "domain",
    files: ["src/domain/**/*.ts", "src/domain/**/*.tsx"],
    forbidden: [
      "@/services/*",
      "@/infra/*",
      "@/api/*",
      "@/app/*",
      "@/components/*",
      "@/runtime/*",
    ],
    because:
      "domain/ must stay pure: no I/O, no framework, no knowledge of how it is stored or served.",
  },
  {
    name: "services",
    files: ["src/services/**/*.ts"],
    forbidden: ["@/infra/*", "@/app/*", "@/components/*"],
    because:
      "services/ depends on repository interfaces it declares, never on a concrete implementation.",
  },
  {
    name: "infra",
    files: ["src/infra/**/*.ts"],
    forbidden: ["@/app/*", "@/components/*"],
    because:
      "infra/ is a leaf: it implements interfaces, it does not call into the UI.",
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
