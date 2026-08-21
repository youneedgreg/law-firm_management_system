import { Effect, Either, Schema } from "effect";
import { notFound, redirect } from "next/navigation";
import { HearingId } from "@/domain/shared/ids";
import { runAs } from "@/runtime/session";
import { HearingService } from "@/services/hearing-service";

/**
 * One hearing, which now redirects to the matter it belongs to.
 *
 * The prototype had a hearing detail page because a hearing was a standalone
 * fixture with a judge, an opposing counsel and a status. A `Hearing` in the
 * domain is a court date on a *matter* — everything a person wants to know
 * while looking at one is on the matter file, and the diary already shows the
 * court, the room, the advocate and the outcome inline.
 *
 * So this exists only to keep old links working, and it says so rather than
 * rendering a page that would be a worse version of two others. The id is still
 * decoded and still scoped: a hearing on somebody else's matter is a 404, not a
 * redirect that leaks which matter it is on.
 */
export default async function HearingRedirectPage({
  params,
}: PageProps<"/calendar/[id]">) {
  const { id } = await params;

  const hearingId = Schema.decodeUnknownEither(HearingId)(id);
  if (Either.isLeft(hearingId)) notFound();

  const caseId = await runAs(
    Effect.gen(function* () {
      const service = yield* HearingService;
      const diary = yield* service.diary();

      const entry = [
        ...diary.awaitingOutcome,
        ...diary.upcoming,
        ...diary.past,
      ].find((each) => each.hearing.id === hearingId.right);

      return entry?.hearing.caseId;
    }).pipe(Effect.catchTag("NotFound", () => Effect.succeed(undefined))),
  );

  if (caseId === undefined) notFound();

  redirect(`/cases/${caseId}`);
}
