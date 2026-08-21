import { Effect, Option } from "effect";
import { Empty } from "@/components/ui";
import { runAs, signedIn } from "@/runtime/session";
import { MessageService } from "@/services/message-service";
import { Composer } from "./Composer";

/**
 * A client's thread with the firm.
 *
 * The client id comes from the *session*, not from the URL — there is no id in
 * this route to tamper with, and `withinScope` would refuse another client's
 * anyway. Both halves matter: the first means an attacker has nothing to try,
 * the second means it would not work if they did.
 *
 * **Reading this page does not mark anything read.** A client opening their own
 * thread must not mark their own messages as seen *by the firm* — that is the
 * bug a single "mark this thread read" produces, and it would quietly empty the
 * firm's waiting queue every time somebody refreshed. `MessageService.thread`
 * marks only when a member of staff opens it.
 */
export default async function PortalMessagesPage() {
  const principal = await signedIn();

  if (principal._tag !== "PortalUser") {
    return (
      <Empty>
        This page is a client&rsquo;s own thread. Staff read correspondence from
        the client&rsquo;s file.
      </Empty>
    );
  }

  const thread = await runAs(
    Effect.flatMap(MessageService, (service) =>
      service.thread(principal.clientId),
    ),
  );

  return (
    <>
      <h2 style={{ fontSize: 28, margin: "0 0 var(--space-2)" }}>Messages</h2>
      <p className="dek" style={{ marginBottom: "var(--space-4)" }}>
        Your correspondence with OKLaw. Messages cannot be edited or withdrawn
        by either side &mdash; a correction is a new message.
      </p>

      <div className="message-thread">
        {thread.entries.length === 0 ? (
          <Empty>
            No messages yet. Anything you send here goes to the advocate
            carrying your matter.
          </Empty>
        ) : (
          thread.entries.map(({ message, authorName, matterNumber }) => (
            <div key={message.id}>
              <div className="message-from">
                {/*
                  A message from the firm names the advocate. One from the
                  client says "You" rather than the company's name, which is
                  what a person reading their own thread expects to see — and
                  is honest, because the record genuinely does not name an
                  individual.
                */}
                {Option.getOrElse(authorName, () => "You")} ·{" "}
                {message.sentAt.toLocaleDateString("en-KE", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
                {Option.isSome(matterNumber) ? (
                  <span className="dek"> · {matterNumber.value}</span>
                ) : null}
              </div>
              <div className="message-text">{message.body}</div>
            </div>
          ))
        )}

        <Composer clientId={principal.clientId} />
      </div>
    </>
  );
}
