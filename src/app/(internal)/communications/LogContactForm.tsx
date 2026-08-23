"use client";

import { useState } from "react";
import { ActionDialog } from "@/components/ActionDialog";
import { SelectField, TextAreaField, TextField } from "@/components/form";
import { CHANNELS, DIRECTIONS } from "@/domain/firm/contact";
import type { CaseId, ClientId } from "@/domain/shared/ids";
import { logContact } from "./actions";
import { constraintsOf } from "@/lib/form-constraints";
import { LogContactForm as LogContactSchema, NO_MATTER } from "./forms";

/** The constraints `LogContactSchema` already carries. See `lib/form-constraints.ts`. */
const field = constraintsOf(LogContactSchema);

/**
 * Recording a conversation that happened elsewhere.
 *
 * **Direction is asked, and the prototype did not ask it.** "Did we chase them
 * or did they chase us" is the first question anybody puts to a contact log,
 * and a log that cannot answer it is a list of events rather than a record of a
 * relationship.
 *
 * The matter dropdown **narrows to the chosen client**, which is why this is a
 * client component with one piece of state. `logContact` refuses a matter that
 * is not that client's, and a form that offered the combination and then
 * refused it would make somebody discover a rule the interface already knew.
 * The alternative — no narrowing — is how a note about the Zenith matter ends
 * up on Wanjiku's file.
 */
export function LogContactForm({
  clients,
  matters,
}: {
  clients: readonly { readonly id: ClientId; readonly name: string }[];
  matters: readonly {
    readonly id: CaseId;
    readonly clientId: ClientId;
    readonly number: string;
    readonly title: string;
  }[];
}) {
  const [client, setClient] = useState<string>("");
  const today = new Date().toISOString().slice(0, 10);

  const theirs = matters.filter((matter) => matter.clientId === client);

  return (
    <ActionDialog
      title="Log a conversation"
      lede="A call, meeting, email or message that happened outside this system — recorded against the client it concerned."
      trigger="Log communication"
      triggerIcon="ph-duotone ph-chat-circle-text"
      submitLabel="Log it"
      pendingLabel="Saving…"
      action={logContact}
    >
      {(state) => {
        const kept = (name: string, fallback = "") =>
          state.values[name] ?? fallback;

        return (
          <>
            <SelectField
              wide
              label="Client"
              name="clientId"
              {...field("clientId")}
              defaultValue={kept("clientId")}
              placeholder="Select a client"
              options={clients.map((each) => ({
                value: each.id,
                label: each.name,
              }))}
              onChange={(event) => setClient(event.target.value)}
              error={state.fields["clientId"]}
            />
            <SelectField
              wide
              label="Matter"
              name="caseId"
              {...field("caseId")}
              defaultValue={kept("caseId", NO_MATTER)}
              options={[
                { value: NO_MATTER, label: "No particular matter" },
                ...theirs.map((matter) => ({
                  value: matter.id,
                  label: `${matter.number} — ${matter.title}`,
                })),
              ]}
              hint={
                client === ""
                  ? "Choose a client first to see their matters."
                  : "Only this client's open matters are offered."
              }
              error={state.fields["caseId"]}
            />
            <SelectField
              label="Channel"
              name="channel"
              {...field("channel")}
              defaultValue={kept("channel")}
              placeholder="How"
              options={[...CHANNELS]}
              error={state.fields["channel"]}
            />
            <SelectField
              label="Direction"
              name="direction"
              {...field("direction")}
              defaultValue={kept("direction", "Outgoing")}
              options={[...DIRECTIONS]}
              hint="Did we contact them, or they us?"
              error={state.fields["direction"]}
            />
            <TextField
              wide
              label="When"
              name="occurredOn"
              type="date"
              {...field("occurredOn")}
              max={today}
              defaultValue={kept("occurredOn", today)}
              hint="A conversation that has not happened yet is an appointment."
              error={state.fields["occurredOn"]}
            />
            <TextAreaField
              wide
              label="Summary"
              name="summary"
              {...field("summary")}
              rows={3}
              defaultValue={kept("summary")}
              placeholder="What was discussed, agreed or sent"
              hint="Your own words. This is a note about the conversation, not a transcript of it."
              error={state.fields["summary"]}
            />
          </>
        );
      }}
    </ActionDialog>
  );
}
