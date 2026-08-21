import Link from "next/link";
import { BackLink, Empty, SectionTitle, TableWrap } from "@/components/ui";
import { caseStatusTag } from "@/lib/format";
import type { ClientFile } from "@/services/client-service";
import { AmendClientForm } from "./AmendClientForm";

/**
 * One client's file.
 *
 * The contacts table only exists for a corporate client, and that is the union
 * showing through rather than a conditional over optional data: an individual
 * has no contacts to render because an individual cannot have any.
 */
export function ClientDetail({
  file,
  mayAmend,
}: {
  file: ClientFile;
  mayAmend: boolean;
}) {
  const { client } = file;

  return (
    <>
      <BackLink href="/clients">Back to clients</BackLink>

      <div className="detail-head">
        <div>
          <h1 className="detail-title">{client.name}</h1>
          <div className="dek">
            {client.number} · {client._tag} · {client.email} · {client.phone}
            {client.kraPin === undefined ? "" : ` · ${client.kraPin}`}
          </div>
        </div>
        {mayAmend ? <AmendClientForm client={client} /> : null}
      </div>

      {client._tag === "Corporate" ? (
        <>
          <SectionTitle>Who may instruct</SectionTitle>
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Email</th>
                  <th>Telephone</th>
                </tr>
              </thead>
              <tbody>
                {client.contacts.map((contact, index) => (
                  <tr key={`${contact.name}-${String(index)}`}>
                    <td>
                      {contact.name}
                      {index === 0 ? (
                        <span className="dek"> · primary</span>
                      ) : null}
                    </td>
                    <td>{contact.role}</td>
                    <td>{contact.email ?? "—"}</td>
                    <td>{contact.phone ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </>
      ) : null}

      <SectionTitle spaced>Matters</SectionTitle>
      {file.matters.length === 0 ? (
        <Empty>No matters on this client&rsquo;s file.</Empty>
      ) : (
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Matter</th>
                <th>Against</th>
                <th>Type</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {file.matters.map((matter) => (
                <tr key={matter.id}>
                  <td>{matter.number}</td>
                  <td>{matter.title}</td>
                  {/*
                    The column the conflict screen searches. Blank is the truth
                    for a conveyance or a probate application, not a gap.
                  */}
                  <td>
                    {matter.opposingParties.length === 0
                      ? "—"
                      : matter.opposingParties.join(", ")}
                  </td>
                  <td>{matter.type}</td>
                  <td>
                    <span className={caseStatusTag(matter.status)}>
                      {matter.status}
                    </span>
                  </td>
                  <td className="cell-action">
                    <Link
                      href={`/cases/${matter.id}`}
                      className="btn btn-ghost"
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </>
  );
}
