import { Effect, Either, Schema } from "effect";
import { notFound } from "next/navigation";
import { may } from "@/domain/identity/permissions";
import { ClientId } from "@/domain/shared/ids";
import { runAs, signedIn } from "@/runtime/session";
import { ClientService } from "@/services/client-service";
import { MessageService } from "@/services/message-service";
import { ClientDetail } from "./ClientDetail";
import { Correspondence } from "./Correspondence";

/**
 * One client, read from Postgres.
 *
 * `generateStaticParams` is gone and so is `CreatedClient` — the browser-side
 * store that stood in for a client created in this session. There is one answer
 * to who the firm acts for and it is in the database.
 *
 * A client id that belongs to another client is `NotFound` rather than a
 * refusal, and for a portal user that is the whole point: telling them a record
 * exists but is not theirs confirms that the firm acts for whoever it is.
 */
export default async function ClientDetailPage({
  params,
}: PageProps<"/clients/[id]">) {
  const { id } = await params;

  const clientId = Schema.decodeUnknownEither(ClientId)(id);
  if (Either.isLeft(clientId)) notFound();

  const principal = await signedIn();

  const [file, thread] = await runAs(
    Effect.all(
      [
        Effect.gen(function* () {
          const service = yield* ClientService;
          return yield* service.file(clientId.right);
        }).pipe(Effect.catchTag("NotFound", () => Effect.succeed(undefined))),
        /**
         * The thread, for whoever may read it.
         *
         * Reading it as a member of staff **marks the client's messages seen**
         * — a write, from a page load, which is unusual enough to say out
         * loud. It is the right moment: the alternative is a "mark as read"
         * button nobody presses, and a waiting queue that stays full of
         * conversations somebody has plainly dealt with.
         */
        may(principal, "message:read")
          ? Effect.flatMap(MessageService, (service) =>
              service.thread(clientId.right),
            ).pipe(Effect.catchTag("NotFound", () => Effect.succeed(undefined)))
          : Effect.succeed(undefined),
      ],
      // Sequential, not concurrent: the thread read writes, and running it
      // beside another read of the same client is a race for no gain.
      { concurrency: 1 },
    ),
  );

  if (file === undefined) notFound();

  return (
    <>
      <ClientDetail file={file} mayAmend={may(principal, "client:write")} />
      {thread === undefined ? null : (
        <Correspondence
          thread={thread}
          mayWrite={may(principal, "message:write")}
        />
      )}
    </>
  );
}
