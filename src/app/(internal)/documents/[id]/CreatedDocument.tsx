"use client";

import { DocumentDetail } from "./DocumentDetail";
import { useAppState } from "@/components/AppState";
import { NotOnFile } from "@/components/ui";

/** A document filed through the upload form, held in the session store. */
export function CreatedDocument({ id }: { id: number }) {
  const { records, hydrated } = useAppState();

  if (!hydrated) return null;

  const document = records.documents.find((entry) => entry.id === id);
  if (!document) {
    return (
      <NotOnFile backHref="/documents" backLabel="Back to documents">
        No document is filed under #{id}.
      </NotOnFile>
    );
  }

  return <DocumentDetail document={document} />;
}
