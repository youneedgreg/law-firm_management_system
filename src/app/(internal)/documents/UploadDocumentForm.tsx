"use client";

import { ActionDialog } from "@/components/ActionDialog";
import { SelectField, TextField } from "@/components/form";
import { CATEGORIES, SIGNATURE_STATUSES } from "@/domain/document/document";
import type { CaseId } from "@/domain/shared/ids";
import { uploadDocument } from "./actions";
import { constraintsOf } from "@/lib/form-constraints";
import { MAX_UPLOAD_BYTES, UploadForm } from "./forms";

/** The constraints `UploadForm` already carries. See `lib/form-constraints.ts`. */
const field = constraintsOf(UploadForm);

/**
 * Putting a document on a matter file.
 *
 * There is no version field and no uploader field. The version is always 1 —
 * this form creates a document, and a second version comes from *revising* the
 * first, which is the only way the numbering can stay reliable when two people
 * upload at once. The uploader is whoever is signed in, for the same reason the
 * timesheet has no fee-earner dropdown: a version records who did it, not who
 * somebody says did it.
 *
 * The prototype had a "Tags" field. It is gone rather than carried across —
 * the domain has no tags, and a field that collects text nothing reads is worse
 * than no field.
 */
export function UploadDocumentForm({
  matters,
}: {
  matters: readonly {
    readonly id: CaseId;
    readonly number: string;
    readonly title: string;
  }[];
}) {
  return (
    <ActionDialog
      title="Upload a document"
      lede="Filed against a matter, versioned from v1, and attributed to you."
      trigger="Upload"
      triggerIcon="ph-duotone ph-upload-simple"
      submitLabel="Upload"
      pendingLabel="Uploading…"
      action={uploadDocument}
    >
      {(state) => {
        const kept = (name: string, fallback = "") =>
          state.values[name] ?? fallback;

        return (
          <>
            <TextField
              wide
              label="File"
              name="file"
              type="file"
              /*
                Hand-written, and the only kind of field that stays that way.
                `UploadForm` describes what the *record* needs; the bytes are
                not a schema field at all — they go to the blob store before
                the row is written, so there is nothing here to derive from.
              */
              required
              hint={
                `Up to ${String(MAX_UPLOAD_BYTES / 1024 / 1024)} MB. ` +
                `If the upload is refused, the file has to be chosen again — ` +
                `a browser will not let a page re-fill a file input.`
              }
              error={state.fields["file"]}
            />
            <TextField
              wide
              label="Document name"
              name="name"
              {...field("name")}
              defaultValue={kept("name")}
              placeholder="e.g. Supplementary affidavit.pdf"
              hint="What it should be called on the file — not necessarily the filename."
              error={state.fields["name"]}
            />
            <SelectField
              wide
              label="Matter"
              name="caseId"
              {...field("caseId")}
              defaultValue={kept("caseId")}
              placeholder="Select a matter"
              options={matters.map((matter) => ({
                value: matter.id,
                label: `${matter.number} — ${matter.title}`,
              }))}
              error={state.fields["caseId"]}
            />
            <SelectField
              label="Category"
              name="category"
              {...field("category")}
              defaultValue={kept("category")}
              placeholder="Select a category"
              options={[...CATEGORIES]}
              error={state.fields["category"]}
            />
            <SelectField
              label="Signature status"
              name="signatureStatus"
              {...field("signatureStatus")}
              defaultValue={kept("signatureStatus", "Not required")}
              options={[...SIGNATURE_STATUSES]}
              error={state.fields["signatureStatus"]}
            />
          </>
        );
      }}
    </ActionDialog>
  );
}
