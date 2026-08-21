import { Effect, Either, Schema } from "effect";
import { DocumentId } from "@/domain/shared/ids";
import { attemptAs } from "@/runtime/session";
import { DocumentService } from "@/services/document-service";

/**
 * Downloading a document.
 *
 * A route handler rather than a Server Action, because what a download needs is
 * an `href`. An anchor with a real URL is a download a browser understands: it
 * can be middle-clicked, copied, opened in a new tab, and it works before any
 * JavaScript has run. A Server Action returning a URL for `window.open` to
 * consume would be the same round trip with a popup blocker in the middle.
 *
 * ## What this hands back is a redirect, not the bytes
 *
 * The service checks `document:read` and the caller's scope, mints a signed
 * URL good for fifteen minutes, and this replies `302` to it. The browser then
 * fetches the object straight from the CDN. Streaming the bytes through here
 * instead would put every megabyte of every download through a function with a
 * memory limit, twice across the network, for no gain in authorisation — the
 * decision has already been made by the time the URL exists.
 *
 * The consequence, stated plainly: whoever holds the redirect target holds a
 * working link to that document for fifteen minutes, regardless of session.
 * That is the trade a CDN download makes, and it is why the window is short and
 * the token is scoped to one pathname and to reads.
 *
 * ## Why the failures answer in status codes and not in prose
 *
 * Nobody reads this response — a browser follows it or reports it. So a refusal
 * is a status: `404` for a document that is not there *or* not in scope (scope
 * conceals, exactly as `withinScope` does everywhere else), `403` for a caller
 * who may not read documents at all, `502` when the store cannot sign.
 */

const STATUS: Readonly<Record<string, number>> = {
  NotPermitted: 403,
  NotFound: 404,
  StorageFailure: 502,
  RepositoryFailure: 500,
};

export async function GET(
  _request: Request,
  context: RouteContext<"/documents/[id]/download">,
) {
  const { id } = await context.params;

  const documentId = Schema.decodeUnknownEither(DocumentId)(id);
  if (Either.isLeft(documentId)) {
    return new Response("Not found", { status: 404 });
  }

  const outcome = await attemptAs(
    Effect.flatMap(DocumentService, (service) =>
      service.download(documentId.right),
    ),
  );

  if (Either.isLeft(outcome)) {
    const status = STATUS[outcome.left._tag] ?? 500;
    return new Response(status === 403 ? "Forbidden" : "Not found", { status });
  }

  return Response.redirect(outcome.right.url, 302);
}
