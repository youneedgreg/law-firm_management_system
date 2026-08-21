import { Duration, Effect, Either } from "effect";
import { ServiceIdentity } from "@/infra/config";
import { attempt } from "@/runtime";
import { DatabaseProbe } from "@/services/repositories";

/**
 * Is this deployment serving, and which one is it?
 *
 * ## Who asks
 *
 * Nothing in the application. This exists for whatever is watching from
 * outside: an uptime monitor, a deployment gate, a person who has just pushed
 * and wants to know which commit is live. That audience is the reason for every
 * decision below.
 *
 * ## Unauthenticated, and therefore silent about detail
 *
 * A health check behind a session is a health check a monitor cannot use, so
 * this one is open — which means it is readable by anybody who finds the URL,
 * and it is written on that assumption. It says *whether* the database
 * answered and how quickly. It never says why one did not: a
 * `RepositoryFailure` carries the driver's message, which can carry the query,
 * and the whole reason that error dies rather than being rendered elsewhere in
 * this codebase applies with more force at an endpoint with no door on it. The
 * reason goes to the log, where `attempt` has already put it.
 *
 * The commit and the environment *are* published, deliberately. Neither is a
 * secret — the repository is public (D-8) — and "which build is this" is the
 * first question of almost every incident.
 *
 * ## 503, not 200 with a sad body
 *
 * Whatever polls this reads the status code; most such things never look at the
 * body at all. A degraded deployment that answered `200 {"status":"down"}`
 * would be reported as healthy by every uptime monitor ever written.
 *
 * ## Never cached
 *
 * `force-dynamic`, because a cached health check is an assertion about the past
 * served with the authority of the present — and it is the exact failure that
 * makes one useless: the page goes static at build time and reports the
 * database as reachable for as long as the cache lives.
 */

export const dynamic = "force-dynamic";

interface Report {
  readonly status: "ok" | "degraded";
  readonly service: string;
  readonly version: string;
  readonly environment: string;
  readonly checks: {
    readonly database: { readonly reachable: boolean; readonly ms?: number };
  };
}

export async function GET(): Promise<Response> {
  /**
   * Two effects rather than one, and not for tidiness: the identity must be
   * reportable even when the database is not answering. A deployment that
   * cannot say which commit it is, because the thing that is broken is the
   * database, is a deployment nobody can reason about during an incident.
   */
  const identity = await attempt(
    ServiceIdentity.pipe(Effect.provide(ServiceIdentity.Default)),
  );

  const ping = await attempt(
    Effect.flatMap(DatabaseProbe, (probe) => probe.ping()),
  );

  const reachable = Either.isRight(ping);

  const report: Report = {
    status: reachable ? "ok" : "degraded",
    service: Either.isRight(identity) ? identity.right.name : "oklaw",
    version: Either.isRight(identity) ? identity.right.version : "unknown",
    environment: Either.isRight(identity)
      ? identity.right.environment
      : "unknown",
    checks: {
      database: Either.isRight(ping)
        ? { reachable: true, ms: Math.round(Duration.toMillis(ping.right)) }
        : { reachable: false },
    },
  };

  return new Response(JSON.stringify(report), {
    status: reachable ? 200 : 503,
    headers: {
      "content-type": "application/json",
      /**
       * Belt and braces beside `force-dynamic`. That directive governs Next;
       * this one governs every CDN and proxy between here and the monitor, any
       * one of which would otherwise be entitled to serve a minute-old answer
       * to a question about right now.
       */
      "cache-control": "no-store",
    },
  });
}
