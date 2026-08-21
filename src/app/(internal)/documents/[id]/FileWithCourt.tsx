"use client";

import { ActionDialog } from "@/components/ActionDialog";
import type { DocumentId } from "@/domain/shared/ids";
import { fileDocument } from "../actions";

/**
 * Recording that a document went to court.
 *
 * A dialog around a single click, because this is the one document operation
 * with no way back. Filing fixes the document: revision refuses from here on,
 * and there is deliberately no un-file — filing is a fact about the world
 * rather than a flag about this system, so a mistake is corrected by saying so
 * in a note, not by making the record claim it never happened.
 *
 * The dialog exists to say that *before* the click rather than after it.
 */
export function FileWithCourtButton({
  id,
  name,
}: {
  id: DocumentId;
  name: string;
}) {
  const file = fileDocument.bind(null, id);

  return (
    <ActionDialog
      title="File with the court"
      lede={`Records that "${name}" is on the court record.`}
      trigger="File with court"
      triggerIcon="ph-duotone ph-gavel"
      triggerVariant="btn-ghost"
      submitLabel="Record as filed"
      pendingLabel="Recording…"
      action={file}
    >
      {(state) => (
        <p className="field-hint" style={{ gridColumn: "1 / -1" }}>
          {state.status === "refused"
            ? ""
            : "A filed document cannot be revised, and this cannot be undone. A later correction is a fresh document, not a new version of this one."}
        </p>
      )}
    </ActionDialog>
  );
}
