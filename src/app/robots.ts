import type { MetadataRoute } from "next";

/**
 * There was no `robots.txt`, so a crawler asking for one got the application's
 * 404 page — a document of HTML, which Lighthouse duly parsed line by line and
 * reported as six syntax errors. A missing file and an invalid one look the
 * same from outside.
 *
 * `/api` is disallowed because it is not a place to browse: every endpoint
 * under it answers 401 without a session, and a crawler working through them
 * would be generating refusals for nothing. Everything else is allowed and
 * costs nothing — the authenticated screens redirect an unauthenticated
 * request to the sign-in page, so a crawler cannot see them whatever this file
 * says. This is not a security boundary and does not pretend to be one; the
 * boundary is `services/policy.ts`, checked on every read.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
  };
}
