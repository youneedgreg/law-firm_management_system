import { Option } from "effect";
import { Empty, SectionTitle } from "@/components/ui";
import type { Thread } from "@/services/message-service";
import { Composer } from "@/app/portal/messages/Composer";

/**
 * The firm's side of a client's thread, on the client's file.
 *
 * It lives here rather than on a "Messages" screen of its own, because
 * correspondence is *about* a client and the person reading it is looking at
 * that client. A separate inbox would be a second place to look for the same
 * thing, and the one that goes unchecked.
 *
 * **Rendering this marked the client's messages read.** That happened in
 * `MessageService.thread`, before this component existed, and it is stated on
 * the screen: a firm that silently records "seen" is one whose staff cannot
 * tell what they have actually dealt with. `unread` is what was waiting when
 * the page was opened, which is why it can still be shown after the marking.
 *
 * The composer is the *same component* the portal uses. There is one way to
 * send a message in this system and one action behind it; the author is taken
 * from the session, so the same form serves both sides and neither can send as
 * the other.
 */
export function Correspondence({
  thread,
  mayWrite,
}: {
  thread: Thread;
  mayWrite: boolean;
}) {
  return (
    <>
      <SectionTitle spaced>Correspondence</SectionTitle>
      <p className="dek" style={{ marginBottom: "var(--space-3)" }}>
        {thread.unread > 0
          ? `${String(thread.unread)} message${thread.unread === 1 ? "" : "s"} from this client ${
              thread.unread === 1 ? "was" : "were"
            } unread until you opened this page.`
          : "Nothing new from this client."}{" "}
        Messages cannot be edited or withdrawn by either side.
      </p>

      <div className="message-thread">
        {thread.entries.length === 0 ? (
          <Empty>No correspondence with this client yet.</Empty>
        ) : (
          thread.entries.map(({ message, authorName, matterNumber }) => (
            <div key={message.id}>
              <div className="message-from">
                {/*
                  The client's side names the client rather than an individual,
                  because the record genuinely does not name one — the portal
                  login belongs to the organisation.
                */}
                {Option.getOrElse(authorName, () => thread.clientName)} ·{" "}
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

        {mayWrite ? (
          <Composer clientId={thread.clientId} writingTo={thread.clientName} />
        ) : null}
      </div>
    </>
  );
}
