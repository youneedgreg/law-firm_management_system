import Link from "next/link";
import { ClientsTable, NewClientForm } from "./ClientsScreen";
import { PageHead } from "@/components/ui";
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

  return (
    <>
      <PageHead title="Clients">
        <NewClientForm />
      </PageHead>

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

      <ClientsTable type={active} />
    </>
  );
}
