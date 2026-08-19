"use client";

import Link from "next/link";
import { useRxValue } from "@effect-rx/rx-react";
import { useAddRecord } from "@/rx/hooks";
import { recordsRx } from "@/rx/session";
import { FormDialog } from "@/components/FormDialog";
import { RadioField, SelectField, TextField } from "@/components/form";
import { TableWrap } from "@/components/ui";
import { CLIENTS, clientTypeLabel } from "@/lib/data/clients";
import { nextId, text } from "@/lib/forms";
import { CONFLICT_STATUSES, type ClientType } from "@/lib/types";

/**
 * The clients screen keeps its tab in the URL, so the page stays a server
 * component; the roll and the intake form live here because both read the
 * clients the forms have added.
 */
export function ClientsTable({ type }: { type: "all" | ClientType }) {
  const records = useRxValue(recordsRx);
  const clients = [...records.clients, ...CLIENTS].filter(
    (client) => type === "all" || client.type === type,
  );

  if (clients.length === 0) {
    return <p className="dek">No clients of this type on the roll yet.</p>;
  }

  return (
    <TableWrap>
      <table className="table">
        <thead>
          <tr>
            <th>Client #</th>
            <th>Name</th>
            <th>Type</th>
            <th>Contact</th>
            <th>Active cases</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {clients.map((client) => (
            <tr key={client.id}>
              <td>{client.number}</td>
              <td>{client.name}</td>
              <td>
                <span
                  className={
                    client.type === "individual"
                      ? "tag tag-outline"
                      : "tag tag-accent"
                  }
                >
                  {clientTypeLabel(client)}
                </span>
              </td>
              <td>{client.contact}</td>
              <td>{client.activeCases}</td>
              <td className="cell-action">
                <Link href={`/clients/${client.id}`} className="btn btn-ghost">
                  View
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export function NewClientForm() {
  const records = useRxValue(recordsRx);
  const add = useAddRecord();
  const clients = [...CLIENTS, ...records.clients];

  function createClient(fields: FormData) {
    const type = text(fields, "type") as ClientType;
    const name = text(fields, "name");

    // Individuals are numbered from 1000, corporates from 2000, as the roll
    // already runs.
    const series = type === "individual" ? 1000 : 2000;
    const takenInSeries = clients
      .filter((client) => client.type === type)
      .map((client) => Number(client.number.split("-")[1]))
      .filter(Number.isFinite);
    const sequence = Math.max(series, ...takenInSeries) + 1;

    add("clients", {
      id: nextId(clients),
      number: `CLT-${sequence}`,
      name,
      type,
      contact: text(fields, "contact") || name,
      email: text(fields, "email"),
      phone: text(fields, "phone"),
      activeCases: 0,
      conflictStatus: text(fields, "conflictStatus"),
    });
  }

  return (
    <FormDialog
      title="Take on a new client"
      lede="Identity, contact details and the conflict check — everything needed before a matter can be opened."
      trigger="New client"
      triggerIcon="ph-duotone ph-plus"
      submitLabel="Add client"
      onSubmit={createClient}
    >
      <TextField
        wide
        label="Client name"
        name="name"
        required
        placeholder="Person or registered company name"
      />
      <RadioField
        wide
        label="Client type"
        name="type"
        defaultValue="individual"
        options={[
          { value: "individual", label: "Individual" },
          { value: "corporate", label: "Corporate" },
        ]}
      />
      <TextField
        label="Primary contact"
        name="contact"
        placeholder="Who the firm deals with"
        hint="Leave blank for an individual acting for themselves."
      />
      <TextField
        label="Email"
        name="email"
        type="email"
        required
        placeholder="name@example.co.ke"
      />
      <TextField
        label="Phone"
        name="phone"
        type="tel"
        required
        placeholder="+254 7xx xxx xxx"
      />
      <SelectField
        label="Conflict check"
        name="conflictStatus"
        defaultValue="Conflict check pending"
        options={CONFLICT_STATUSES}
      />
    </FormDialog>
  );
}
