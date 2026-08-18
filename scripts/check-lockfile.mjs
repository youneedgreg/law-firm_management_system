/**
 * Checks that every dependency edge in package-lock.json points at an entry
 * that is also in the lock.
 *
 * This is the invariant `npm ci` enforces, and it is easy to break by accident:
 * incremental `npm install` runs resolve optional platform packages only for
 * the current OS, so a lock generated on macOS can reference (say)
 * `@img/sharp-wasm32` without including the `@emnapi/runtime` it depends on.
 * Everything works locally and CI dies with "Missing: X from lock file".
 *
 * Deliberately dependency-free so it can run before anything is installed.
 * Only presence is checked, not semver satisfaction — absence is the failure
 * mode that actually bites, and checking ranges would mean taking a dependency.
 */
import { readFileSync } from "node:fs";

const { packages } = JSON.parse(readFileSync("package-lock.json", "utf8"));

/** Node resolution: walk up the node_modules chain from the dependent. */
function resolve(fromPath, name) {
  let dir = fromPath;
  for (;;) {
    const candidate =
      dir === "" ? `node_modules/${name}` : `${dir}/node_modules/${name}`;
    if (packages[candidate]) return true;
    if (dir === "") return false;
    const cut = dir.lastIndexOf("/node_modules/");
    dir = cut === -1 ? "" : dir.slice(0, cut);
  }
}

const missing = [];

for (const [path, meta] of Object.entries(packages)) {
  const edges = {
    ...(meta.dependencies ?? {}),
    ...(meta.optionalDependencies ?? {}),
  };

  for (const [name, range] of Object.entries(edges)) {
    if (range.startsWith("npm:") || range.startsWith("file:")) continue;
    if (!resolve(path, name)) {
      missing.push(`  ${name}@${range} — required by ${path || "(root)"}`);
    }
  }
}

if (missing.length > 0) {
  console.error(
    `package-lock.json is incomplete; ${missing.length} dependency edge(s) point at\n` +
      `entries that are not in the lock. \`npm ci\` will fail:\n\n` +
      missing.join("\n") +
      `\n\nFix: rm -rf node_modules package-lock.json && npm install\n` +
      `(a plain \`npm install --package-lock-only\` will not repair this)\n`,
  );
  process.exit(1);
}

console.log(
  `package-lock.json OK — ${Object.keys(packages).length} entries, every edge resolves.`,
);
