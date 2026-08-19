"use client";

import { useRxValue } from "@effect-rx/rx-react";
import { useAddRecord } from "@/rx/hooks";
import { recordsRx } from "@/rx/session";
import { FormDialog } from "@/components/FormDialog";
import { SelectField, TextAreaField, TextField } from "@/components/form";
import { CLIENTS } from "@/lib/data/clients";
import { CHANNEL_ICONS, COMMUNICATIONS } from "@/lib/data/firm";
import { displayDate } from "@/lib/format";
import { nextId, text } from "@/lib/forms";
import { COMMUNICATION_CHANNELS, type CommunicationChannel } from "@/lib/types";

export function CommunicationLog() {
  const records = useRxValue(recordsRx);
  const entries = [...records.communications, ...COMMUNICATIONS];

  return (
    <>
      {entries.map((entry) => (
        <div className="row row-icon" key={entry.id}>
          <i className={`${entry.icon} ink-accent`} aria-hidden />
          <div>
            <div style={{ fontSize: 14 }}>
              <strong>{entry.channel}</strong> — {entry.with}
            </div>
            <div className="row-meta">
              {entry.summary} · {entry.date}
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

export function LogCommunicationForm() {
  const records = useRxValue(recordsRx);
  const add = useAddRecord();
  const clients = [...records.clients, ...CLIENTS];
  const entries = [...COMMUNICATIONS, ...records.communications];

  function logCommunication(fields: FormData) {
    const channel = text(fields, "channel") as CommunicationChannel;

    add("communications", {
      id: nextId(entries),
      channel,
      with: text(fields, "with"),
      summary: text(fields, "summary"),
      date: displayDate(text(fields, "date")),
      // The glyph follows the channel, so the log stays scannable down the
      // left-hand rail.
      icon: CHANNEL_ICONS[channel],
    });
  }

  return (
    <FormDialog
      title="Log a communication"
      lede="Every call, email, message and meeting recorded against the client it concerns."
      trigger="Log communication"
      triggerIcon="ph-duotone ph-chat-circle-text"
      submitLabel="Log entry"
      onSubmit={logCommunication}
    >
      <SelectField
        label="Channel"
        name="channel"
        required
        defaultValue=""
        placeholder="Select a channel"
        options={COMMUNICATION_CHANNELS}
      />
      <SelectField
        label="With"
        name="with"
        required
        defaultValue=""
        placeholder="Select a client"
        options={clients.map((client) => client.name)}
      />
      <TextAreaField
        wide
        label="Summary"
        name="summary"
        required
        rows={3}
        placeholder="What was discussed, agreed or sent"
      />
      <TextField label="Date" name="date" type="date" required />
    </FormDialog>
  );
}
