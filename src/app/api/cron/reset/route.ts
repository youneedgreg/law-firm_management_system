import { createHash, timingSafeEqual } from "node:crypto";
import { Effect, Either, Redacted } from "effect";
import { CronConfig } from "@/infra/config";
import { attempt } from "@/runtime";
import { resetDemoData } from "@/runtime/reset";

/**
 * Puts the demonstration data back, every night at midnight UTC (D-5).
 *
 * ## Why a reset exists at all
 *
 * This deployment is a demonstration that strangers are invited to press
 * buttons in, signed in as a managing partner who may do anything. Without a
 * reset, the firm on display is whatever the last visitor left behind: matters
 * closed, fee notes paid, client money moved. The dataset is the argument, so
 * it is restored on a schedule rather than defended by making the demo
 * read-only — a read-only demo of a system whose interesting behaviour is all
 * in its refusals would demonstrate nothing.
 *
 * The reset runs the same program `npm run db:seed` does. See
 * `runtime/reset.ts` for why that is one program and not two.
 *
 * ## What it costs, stated rather than discovered
 *
 * The seed wipes `users`, and sessions cascade from it — so anybody signed in
 * at midnight is signed out, mid-page. For a demonstration that is a quirk; in
 * a real system it is the reason a reset like this would never be pointed at
 * production. It is also why the trail survives: `audit_log` refuses `DELETE`
 * outright and is not touched here, so the record of what a visitor did outlives
 * the records they did it to. That is Phase 6's guarantee holding under the one
 * operation that would most like an exception from it.
 *
 * ## The door
 *
 * `/api` is excluded from `proxy.ts`, so this path is reachable by anyone who
 * finds it. The only thing in front of it is the shared secret Vercel attaches
 * to a cron invocation, and three properties matter:
 *
 * - **No secret configured means refused, not open.** `CronConfig` reads
 *   `CRON_SECRET` as required, so an unset variable produces no config and this
 *   answers 503 without ever reaching the seed.
 * - **The comparison is timing-safe**, over digests rather than the values, so
 *   neither the length nor the first differing byte is readable from how long
 *   the answer took.
 * - **It says nothing.** A wrong secret gets `401` and an empty body. There is
 *   no message distinguishing "no header" from "wrong value", because the only
 *   party who benefits from that distinction is the one guessing.
 */

/** The wipe-and-load takes longer than a page render; the platform's ceiling. */
export const maxDuration = 300;

/** A cached reset is a reset that did not happen. */
export const dynamic = "force-dynamic";

const digest = (value: string): Buffer =>
  createHash("sha256").update(value).digest();

/**
 * Constant-time, and over hashes rather than the strings themselves.
 *
 * `timingSafeEqual` throws on buffers of different lengths, which would leak
 * the secret's length through a 500 — and comparing digests fixes both halves
 * of that at once: they are always 32 bytes, and they differ everywhere as soon
 * as the inputs differ anywhere.
 */
const presented = (header: string | null, secret: string): boolean => {
  const offered = header?.startsWith("Bearer ") ? header.slice(7) : "";
  return timingSafeEqual(digest(offered), digest(secret));
};

export async function GET(request: Request): Promise<Response> {
  const configured = await attempt(
    Effect.map(CronConfig, (config) => Redacted.value(config.secret)).pipe(
      Effect.provide(CronConfig.Default),
    ),
  );

  if (Either.isLeft(configured)) {
    /**
     * Logged rather than described in the response. A deployment with no
     * `CRON_SECRET` is a misconfiguration its operator needs to see, and the
     * caller is either the platform — which reports the status code — or
     * somebody who should learn nothing about why this refused.
     */
    return new Response(null, { status: 503 });
  }

  if (!presented(request.headers.get("authorization"), configured.right)) {
    return new Response(null, { status: 401 });
  }

  const started = Date.now();
  const reset = await resetDemoData();
  const ms = Date.now() - started;

  if (Either.isLeft(reset)) {
    /**
     * `resetDemoData` has already logged the reason at `Error`, with the trace
     * id on the line. What goes back is the fact and the duration: a reset that
     * failed after four minutes and one that failed in eighty milliseconds are
     * different incidents, and the platform's own view shows only the status.
     */
    return Response.json({ reset: false, ms }, { status: 500 });
  }

  return Response.json({ reset: true, ms }, { status: 200 });
}
