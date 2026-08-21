"use client";

import { ActionDialog } from "@/components/ActionDialog";
import { TextField } from "@/components/form";
import type { DocumentId } from "@/domain/shared/ids";
import { MAX_UPLOAD_BYTES } from "../forms";
import { reviseDocument } from "../actions";

/**
 * A new version of a document already on file.
 *
 * One field, and the absences are the design. The name, the matter and the
 * category are not re-asked: a revision is *the same document*, and letting any
 * of them change here would make "version 3" mean something different from
 * "version 2" under one id. The version number is not asked either — it is
 * assigned inside a transaction, so two people revising at once get 3 and 4
 * rather than both claiming 3.
 */
export function ReviseDocumentForm({
  id,
  name,
}: {
  id: DocumentId;
  name: string;
}) {
  const revise = reviseDocument.bind(null, id);

  return (
    <ActionDialog
      title="Upload a new version"
      lede={`Adds the next version of "${name}". The previous versions stay on file and stay downloadable.`}
      trigger="Revise"
      triggerIcon="ph-duotone ph-file-plus"
      triggerVariant="btn-ghost"
      submitLabel="Upload version"
      pendingLabel="Uploading…"
      action={revise}
    >
      {(state) => (
        <TextField
          wide
          label="File"
          name="file"
          type="file"
          required
          hint={`Up to ${String(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`}
          error={state.fields["file"]}
        />
      )}
    </ActionDialog>
  );
}
