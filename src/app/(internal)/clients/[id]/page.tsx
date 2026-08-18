import { ClientDetail } from "./ClientDetail";
import { CreatedClient } from "./CreatedClient";
import { casesForClient } from "@/lib/data/cases";
import { CLIENTS, getClient } from "@/lib/data/clients";
import { documentsForCaseNumbers } from "@/lib/data/documents";

export function generateStaticParams() {
  return CLIENTS.map((client) => ({ id: String(client.id) }));
}

export default async function ClientDetailPage({
  params,
}: PageProps<"/clients/[id]">) {
  const { id } = await params;
  const client = getClient(Number(id));

  // An id outside the seed data belongs to a client the intake form created,
  // which only the browser can see.
  if (!client) return <CreatedClient id={Number(id)} />;

  const cases = casesForClient(client.id);
  const documents = documentsForCaseNumbers(cases.map((c) => c.number));

  return <ClientDetail client={client} cases={cases} documents={documents} />;
}
