import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import { COOKIE_PREFIX } from "@/infra/auth/options";

/**
 * An optimistic redirect, and **not** a security boundary.
 *
 * It checks whether a session cookie is *present*. It does not verify the
 * signature, does not read the database, and does not know who the cookie
 * claims to be — so a forged cookie of the right name walks straight past it.
 * That is fine, and is the design: everything past this point checks properly.
 * `CaseService` requires `CurrentUser` in its type and cannot run without a
 * principal resolved from a verified session; the API middleware does the same
 * for every endpoint. This exists so that a signed-out person following a
 * bookmark lands on the sign-in page instead of watching a dashboard render and
 * then bounce.
 *
 * Next's own guidance says the same thing — proxy is for optimistic checks, not
 * session management — and ADR 0004 committed to it before any of this was
 * written. Getting it the other way round is the classic Next.js
 * authentication bug: a middleware that "protects" routes, a data layer that
 * assumes it worked, and a Server Action that never passed through the
 * middleware at all.
 *
 * Note in particular that `/api` is **excluded**. An API client that is not
 * signed in should be told so in JSON, with a 401, by the middleware that knows
 * what it is talking to — redirecting it to an HTML sign-in page produces a 200
 * full of markup, which is the least useful possible answer to a fetch.
 */
export function proxy(request: NextRequest): NextResponse {
  const session = getSessionCookie(request, { cookiePrefix: COOKIE_PREFIX });
  if (session !== null) return NextResponse.next();

  const signIn = new URL("/sign-in", request.url);

  /**
   * Where they were going, so signing in resumes it rather than dropping
   * everyone on the dashboard. The action validates this as a relative path
   * before following it; a `next` that is not one is an open redirect.
   */
  signIn.searchParams.set(
    "next",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );

  return NextResponse.redirect(signIn);
}

export const config = {
  /**
   * Everything except: the sign-in page itself (which would be a loop), the
   * API (see above), Next's own asset routes, and the favicon.
   *
   * Written as one negative lookahead because the matcher is evaluated before
   * the function runs — a route that does not match never wakes this up at all,
   * which is the difference between a redirect check and a per-asset cost.
   */
  matcher: ["/((?!sign-in|api|_next/static|_next/image|favicon.ico).*)"],
};
