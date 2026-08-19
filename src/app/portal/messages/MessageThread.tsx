"use client";

import { useRxValue } from "@effect-rx/rx-react";
import { useAddRecord } from "@/rx/hooks";
import { recordsRx } from "@/rx/session";
import { PORTAL_CLIENT, portalMessages } from "@/lib/data/portal";
import { today } from "@/lib/format";
import { text } from "@/lib/forms";

/**
 * The client's thread with the firm. Messages sent here are held in the same
 * session store the rest of the app writes to, so the thread keeps them.
 */
export function MessageThread() {
  const records = useRxValue(recordsRx);
  const add = useAddRecord();
  const messages = [...portalMessages(), ...[...records.messages].reverse()];

  function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = text(new FormData(form), "message");
    if (!body) return;

    add("messages", {
      from: PORTAL_CLIENT.contact,
      date: today(),
      text: body,
    });
    form.reset();
  }

  return (
    <div className="message-thread">
      {messages.map((message) => (
        <div key={`${message.from}-${message.date}-${message.text}`}>
          <div className="message-from">
            {message.from} · {message.date}
          </div>
          <div className="message-text">{message.text}</div>
        </div>
      ))}

      <form className="composer" onSubmit={send}>
        <input
          className="input"
          name="message"
          required
          style={{ flex: 1 }}
          placeholder="Type a message to your advocate…"
          aria-label="Message your advocate"
        />
        <button type="submit" className="btn btn-primary">
          Send
        </button>
      </form>
    </div>
  );
}
