"use client";

import { ClientDetail } from "./ClientDetail";
import { useAppState } from "@/components/AppState";
import { NotOnFile } from "@/components/ui";
import { CASES } from "@/lib/data/cases";
import { DOCUMENTS } from "@/lib/data/documents";

/**
 * A client taken on through the intake form lives in the session store, not in
 * the seed data the server renders from, so its file is assembled here.
 */
export function CreatedClient({ id }: { id: number }) {
  const { records, hydrated } = useAppState();

  // Nothing to show until the store has been read; rendering "not on file"
  // first would flash a wrong answer.
  if (!hydrated) return null;

  const client = records.clients.find((entry) => entry.id === id);
  if (!client) {
    return (
      <NotOnFile backHref="/clients" backLabel="Back to clients">
        No client is filed under #{id}.
      </NotOnFile>
    );
  }

  const cases = [...records.cases, ...CASES].filter(
    (legalCase) => legalCase.clientId === client.id,
  );
  const caseNumbers = cases.map((legalCase) => legalCase.number);
  const documents = [...records.documents, ...DOCUMENTS].filter((document) =>
    caseNumbers.includes(document.case),
  );

  return <ClientDetail client={client} cases={cases} documents={documents} />;
}
