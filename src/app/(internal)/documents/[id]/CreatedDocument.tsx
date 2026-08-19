"use client";

import { DocumentDetail } from "./DocumentDetail";
import { useRxValue } from "@effect-rx/rx-react";
import { hydratedRx, recordsRx } from "@/rx/session";
import { NotOnFile } from "@/components/ui";

/** A document filed through the upload form, held in the session store. */
export function CreatedDocument({ id }: { id: number }) {
  const records = useRxValue(recordsRx);
  const hydrated = useRxValue(hydratedRx);

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
