import { Effect, Either, Schema } from "effect";
import { notFound } from "next/navigation";
import { CaseId } from "@/domain/shared/ids";
import { run } from "@/runtime";
import { CaseService } from "@/services/case-service";
import { CaseDetail } from "./CaseDetail";

/**
 * One matter, read from Postgres.
 *
 * No `generateStaticParams`. The matters are rows now, and a build-time list of
 * ids would be a list of whichever matters existed when the build ran — every
 * file opened afterwards would 404 until the next deploy.
 *
 * The id is decoded before it is used. `params.id` is whatever is in the URL, so
 * `/cases/nonsense` reaching the database as a uuid comparison is a query that
 * fails rather than a page that 404s. Decoding first makes the two cases the
 * same answer, which is also the right answer: a malformed id names no matter.
 */
export default async function CaseDetailPage({
  params,
}: PageProps<"/cases/[id]">) {
  const { id } = await params;

  const matterId = Schema.decodeUnknownEither(CaseId)(id);
  if (Either.isLeft(matterId)) notFound();

  /**
   * A matter that is not on file is a 404, not a 500. Every other failure — a
   * database that will not answer, a stored row the domain refuses to decode —
   * stays in the channel and reaches `error.tsx`, because those are not "no
   * such page".
   *
   * `notFound()` is called *after* the effect rather than inside it. It works by
   * throwing a control-flow exception for the framework to catch, and an
   * exception thrown inside an Effect is a defect: Effect would catch it, wrap
   * it, and hand it back as a failed run — so the page would render the error
   * boundary instead of the 404 it asked for. Turning the absence into a value
   * first keeps the throw where Next can see it.
   */
  const file = await run(
    Effect.gen(function* () {
      const service = yield* CaseService;
      return yield* service.file(matterId.right);
    }).pipe(Effect.catchTag("NotFound", () => Effect.succeed(undefined))),
  );

  if (file === undefined) notFound();

  return <CaseDetail file={file} />;
}
