import { CaseDetail } from "./CaseDetail";
import { CreatedCase } from "./CreatedCase";
import { CASES, getCase } from "@/lib/data/cases";
import { getClient } from "@/lib/data/clients";

export function generateStaticParams() {
  return CASES.map((legalCase) => ({ id: String(legalCase.id) }));
}

export default async function CaseDetailPage({
  params,
}: PageProps<"/cases/[id]">) {
  const { id } = await params;
  const legalCase = getCase(Number(id));

  // Outside the seed data, the matter was opened in this browser session.
  if (!legalCase) return <CreatedCase id={Number(id)} />;

  return (
    <CaseDetail legalCase={legalCase} client={getClient(legalCase.clientId)} />
  );
}
