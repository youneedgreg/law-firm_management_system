import Link from "next/link";
import { PageHead, TableWrap } from "@/components/ui";
import { CLIENTS, clientTypeLabel } from "@/lib/data/clients";
import type { ClientType } from "@/lib/types";

const TABS: { key: "all" | ClientType; label: string }[] = [
  { key: "all", label: "All" },
  { key: "individual", label: "Individual" },
  { key: "corporate", label: "Corporate" },
];

/**
 * The tab lives in the URL rather than component state, so a filtered list is
 * linkable and the page stays a server component.
 */
export default async function ClientsPage({
  searchParams,
}: PageProps<"/clients">) {
  const { type } = await searchParams;
  const active = TABS.some((tab) => tab.key === type)
    ? (type as "all" | ClientType)
    : "all";

  const clients = CLIENTS.filter(
    (client) => active === "all" || client.type === active,
  );

  return (
    <>
      <PageHead title="Clients">
        <span className="btn btn-primary">
          <i className="ph-duotone ph-plus" aria-hidden /> New client
        </span>
      </PageHead>

      <div className="filter-row">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={tab.key === "all" ? "/clients" : `/clients?type=${tab.key}`}
            className={active === tab.key ? "tag tag-accent" : "tag tag-outline"}
            aria-current={active === tab.key ? "page" : undefined}
          >
            {tab.label}
          </Link>
        ))}
      </div>

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
    </>
  );
}
