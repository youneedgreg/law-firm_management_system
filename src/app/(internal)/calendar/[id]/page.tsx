import { CreatedHearing } from "./CreatedHearing";
import { HearingDetail } from "./HearingDetail";
import { getCase } from "@/lib/data/cases";
import { HEARINGS, getHearing } from "@/lib/data/hearings";

export function generateStaticParams() {
  return HEARINGS.map((hearing) => ({ id: String(hearing.id) }));
}

export default async function HearingDetailPage({
  params,
}: PageProps<"/calendar/[id]">) {
  const { id } = await params;
  const hearing = getHearing(Number(id));

  // Outside the seed data, the listing was scheduled in this browser session.
  if (!hearing) return <CreatedHearing id={Number(id)} />;

  return (
    <HearingDetail hearing={hearing} legalCase={getCase(hearing.caseId)} />
  );
}
