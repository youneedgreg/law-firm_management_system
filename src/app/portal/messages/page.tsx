import { MessageThread } from "./MessageThread";

export default function PortalMessagesPage() {
  return (
    <>
      <h2 style={{ fontSize: 28, margin: "0 0 var(--space-4)" }}>Messages</h2>

      <MessageThread />
    </>
  );
}
