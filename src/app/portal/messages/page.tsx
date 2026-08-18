import { portalMessages } from "@/lib/data/portal";

export default function PortalMessagesPage() {
  return (
    <>
      <h2 style={{ fontSize: 28, margin: "0 0 var(--space-4)" }}>Messages</h2>

      <div className="message-thread">
        {portalMessages().map((message) => (
          <div key={`${message.from}-${message.date}-${message.text}`}>
            <div className="message-from">
              {message.from} · {message.date}
            </div>
            <div className="message-text">{message.text}</div>
          </div>
        ))}

        <form className="composer">
          <input
            className="input"
            style={{ flex: 1 }}
            placeholder="Type a message to your advocate…"
            aria-label="Message your advocate"
          />
          <button type="submit" className="btn btn-primary">
            Send
          </button>
        </form>
      </div>
    </>
  );
}
