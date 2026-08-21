import { Effect, Either, Schema } from "effect";
import { notFound } from "next/navigation";
import { may } from "@/domain/identity/permissions";
import { DocumentId } from "@/domain/shared/ids";
import { runAs, signedIn } from "@/runtime/session";
import { DocumentService } from "@/services/document-service";
import { DocumentDetail } from "./DocumentDetail";

/**
 * One document, read from Postgres.
 *
 * `generateStaticParams` is gone with the mock data, and could not come back:
 * a register changes on every upload, and these pages are scoped per caller
 * anyway — what a portal user may see is not what a partner sees, so there is
 * no one page to build ahead of time. `CreatedDocument`, the browser-side store
 * that stood in for a document uploaded in this session, is gone with it.
 *
 * A document that does not exist and one on somebody else's matter arrive here
 * as the same `NotFound`. That is `withinScope` working as designed: telling a
 * client "that document exists but is not yours" confirms the existence of a
 * file they have no business knowing about.
 */
export default async function DocumentDetailPage({
  params,
}: PageProps<"/documents/[id]">) {
  const { id } = await params;

  const documentId = Schema.decodeUnknownEither(DocumentId)(id);
  if (Either.isLeft(documentId)) notFound();

  const principal = await signedIn();

  const summary = await runAs(
    Effect.gen(function* () {
      const service = yield* DocumentService;
      return yield* service.byId(documentId.right);
    }).pipe(Effect.catchTag("NotFound", () => Effect.succeed(undefined))),
  );

  if (summary === undefined) notFound();

  return (
    <DocumentDetail
      summary={summary}
      mayWrite={may(principal, "document:write")}
    />
  );
}
