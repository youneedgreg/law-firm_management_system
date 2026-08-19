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
};

export default nextConfig;
