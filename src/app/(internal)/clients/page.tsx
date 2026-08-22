import Link from "next/link";
import { Effect } from "effect";
import { may } from "@/domain/identity/permissions";
import { Empty, PageHead, SectionTitle, TableWrap } from "@/components/ui";
import { runAs, signedIn } from "@/runtime/session";
import { ClientService } from "@/services/client-service";
import { MessageService } from "@/services/message-service";
import { ConflictScreen } from "./ConflictScreen";
import { NewClientForm } from "./NewClientForm";

const TABS = [
  { key: "all", label: "All" },
  { key: "Individual", label: "Individual" },
  { key: "Corporate", label: "Corporate" },
] as const;

type Tab = (typeof TABS)[number]["key"];

/**
 * The client directory, read from Postgres.
 *
 * The tab lives in the URL rather than component state, so a filtered list is
 * linkable — and unlike the caseload's status filter, this one is applied in
 * the page rather than by the service: the whole directory is one read of a few
 * dozen rows, and `ClientSummary` already carries the discriminant. A round
 * trip to filter a list that is already in hand would be the caseload's trade
 * made in the direction where it does not pay.
 *
 * A signed-in client sees exactly one row: themselves. That is the same
 * `directory` operation, scoped in the query rather than filtered afterwards —
 * see `ClientService`.
 */
export default async function ClientsPage({
  searchParams,
}: PageProps<"/clients">) {
  const { type } = await searchParams;
  const active: Tab = TABS.some((tab) => tab.key === type)
    ? (type as Tab)
    : "all";

  const principal = await signedIn();
  const mayWrite = may(principal, "client:write");

  const [directory, waiting] = await runAs(
    Effect.all(
      [
        Effect.flatMap(ClientService, (service) => service.directory()),
        Effect.flatMap(MessageService, (service) => service.waiting()),
      ],
      { concurrency: "unbounded" },
    ),
  );

  const shown =
    active === "all"
      ? directory
      : directory.filter((summary) => summary.client._tag === active);

  return (
    <>
      <PageHead title="Clients">
        {mayWrite ? (
          <>
            <ConflictScreen />
            <NewClientForm />
          </>
        ) : null}
      </PageHead>

      {/*
        Above the directory, for the same reason `awaitingOutcome` sits above
        the court diary: it is the only part of this page that is urgent, and
        putting the list first — which is what a directory screen normally does
        — buries it under everything that is merely there.

        It is not an unread count. A client whose message somebody *read* and
        did not answer is the worse case and the one that ends in a complaint,
        so those are shown too, marked as read.
      */}
      {waiting.length > 0 ? (
        <section style={{ marginBottom: "var(--space-6)" }}>
          <SectionTitle>Waiting on a reply</SectionTitle>
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Asked</th>
                  <th>Waiting</th>
                  <th>
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {waiting.map((entry) => (
                  <tr key={entry.clientId}>
                    <td className="cell-strong">{entry.clientName}</td>
                    <td>
                      {entry.body}
                      <div className="dek">
                        {entry.seen ? "Read, and not answered" : "Not yet read"}
                      </div>
                    </td>
                    <td>
                      {entry.hours < 48
                        ? `${String(entry.hours)} hours`
                        : `${String(Math.floor(entry.hours / 24))} days`}
                    </td>
                    <td className="cell-action">
                      <Link
                        href={`/clients/${entry.clientId}`}
                        className="btn btn-secondary btn-sm"
                      >
                        Reply
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </section>
      ) : null}

      <div className="filter-row">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={tab.key === "all" ? "/clients" : `/clients?type=${tab.key}`}
            className={
              active === tab.key ? "tag tag-accent" : "tag tag-outline"
            }
            aria-current={active === tab.key ? "page" : undefined}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {shown.length === 0 ? (
        <Empty>No clients on file.</Empty>
      ) : (
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Kind</th>
                <th>Instructions from</th>
                <th>Open matters</th>
                <th>Total</th>
                <th>
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((summary) => (
                <tr key={summary.client.id}>
                  <td>
                    <strong>{summary.client.name}</strong>
                    <div className="dek">{summary.client.number}</div>
                  </td>
                  <td>{summary.client._tag}</td>
                  <td>{summary.primaryContact}</td>
                  <td>{summary.openMatters}</td>
                  <td>{summary.totalMatters}</td>
                  <td className="cell-action">
                    <Link
                      href={`/clients/${summary.client.id}`}
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
