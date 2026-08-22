import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * `pg` opens raw TCP and TLS sockets, and bundling it for Server Components
   * breaks that: the first query against Neon hangs and comes back
   * `PgClient: Connection timed out`, while the identical layer run under `tsx`
   * connects in under a second. Left external, it is loaded through Node's own
   * `require` and behaves the same in both.
   *
   * The whole driver stack is listed, not just `pg`. `pg-pool` and `pg-cursor`
   * reach back into `pg`'s internals, so a bundled copy of one against an
   * external copy of the other is two `pg` modules pretending to be one.
   */
  serverExternalPackages: ["pg", "pg-pool", "pg-cursor", "pg-types"],

  /**
   * Ships source maps for the browser bundles.
   *
   * The usual reason not to is that a source map hands out the source. This
   * repository is public and has been since Phase 0 (D-8), so it hands out
   * nothing GitHub does not — and it buys two things that matter here. A stack
   * trace from `onRequestError` points at a line somebody can read rather than
   * at `1ed4xtf-yn7bz.js:1:48210`, which is the difference between Phase 8's
   * error tracking being useful and being a receipt. And a reviewer looking at
   * the deployed application can open a component and see it, which for a
   * portfolio is the point rather than a leak.
   *
   * The cost is deploy size, and nothing else: a source map is fetched only
   * when devtools is open, so no visitor ever downloads one.
   */
  productionBrowserSourceMaps: true,
};

export default nextConfig;
