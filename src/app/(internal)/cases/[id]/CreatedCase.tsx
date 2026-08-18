"use client";

import { CaseDetail } from "./CaseDetail";
import { useAppState } from "@/components/AppState";
import { NotOnFile } from "@/components/ui";
import { CLIENTS } from "@/lib/data/clients";

/** A matter opened through the new-case form, held in the session store. */
export function CreatedCase({ id }: { id: number }) {
  const { records, hydrated } = useAppState();

  if (!hydrated) return null;

  const legalCase = records.cases.find((entry) => entry.id === id);
  if (!legalCase) {
    return (
      <NotOnFile backHref="/cases" backLabel="Back to cases">
        No matter is filed under #{id}.
      </NotOnFile>
    );
  }

  const client = [...records.clients, ...CLIENTS].find(
    (entry) => entry.id === legalCase.clientId,
  );

  return <CaseDetail legalCase={legalCase} client={client} />;
}
