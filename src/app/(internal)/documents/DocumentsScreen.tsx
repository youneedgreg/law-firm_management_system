"use client";

import Link from "next/link";
import { useAppState } from "@/components/AppState";
import { FormDialog } from "@/components/FormDialog";
import { SelectField, TextField } from "@/components/form";
import { CASES } from "@/lib/data/cases";
import { DOCUMENTS } from "@/lib/data/documents";
import { signatureTag, today } from "@/lib/format";
import { nextId, tags, text } from "@/lib/forms";
import {
  DOCUMENT_CATEGORIES,
  SIGNATURE_STATUSES,
  type DocumentCategory,
  type SignatureStatus,
} from "@/lib/types";

export function DocumentGrid({
  category,
}: {
  category: DocumentCategory | "all";
}) {
  const { records } = useAppState();
  const documents = [...records.documents, ...DOCUMENTS].filter(
    (document) => category === "all" || document.category === category,
  );

  if (documents.length === 0) {
    return <p className="dek">No documents filed under this category.</p>;
  }

  return (
    <div className="card-grid">
      {documents.map((document) => (
        <Link
          key={document.id}
          href={`/documents/${document.id}`}
          className="card elev-sm"
          style={{ color: "inherit", textDecoration: "none" }}
        >
          <div className="card-kicker">{document.category}</div>
          <div className="card-title" style={{ fontSize: 16 }}>
            {document.name}
          </div>
          <div className="card-meta">
            {document.case} · v{document.version} · {document.date}
          </div>
          <div>
            <span className={signatureTag(document.sigStatus)}>
              {document.sigStatus}
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}

export function UploadDocumentForm() {
  const { records, add } = useAppState();
  const cases = [...records.cases, ...CASES];
  const documents = [...DOCUMENTS, ...records.documents];

  function upload(fields: FormData) {
    const id = nextId(documents);
    const filedOn = today();
    const uploader = text(fields, "uploadedBy");

    add("documents", {
      id,
      name: text(fields, "name"),
      category: text(fields, "category") as DocumentCategory,
      case: text(fields, "case"),
      version: 1,
      date: filedOn,
      sigStatus: text(fields, "sigStatus") as SignatureStatus,
      versions: [{ n: 1, date: filedOn, by: uploader }],
      tags: tags(fields, "tags"),
    });
  }

  return (
    <FormDialog
      title="Upload a document"
      lede="Filed against a matter, versioned from v1, and tracked through signature."
      trigger="Upload"
      triggerIcon="ph-duotone ph-upload-simple"
      submitLabel="Upload"
      onSubmit={upload}
    >
      <TextField
        wide
        label="File"
        name="file"
        type="file"
        hint="Held in the browser for this demo — nothing leaves the machine."
      />
      <TextField
        wide
        label="Document name"
        name="name"
        required
        placeholder="e.g. Supplementary affidavit.pdf"
      />
      <SelectField
        label="Category"
        name="category"
        required
        defaultValue=""
        placeholder="Select a category"
        options={DOCUMENT_CATEGORIES}
      />
      <SelectField
        label="Case"
        name="case"
        required
        defaultValue=""
        placeholder="Select a case"
        options={cases.map((legalCase) => ({
          value: legalCase.number,
          label: `${legalCase.number} — ${legalCase.title}`,
        }))}
      />
      <SelectField
        label="Signature status"
        name="sigStatus"
        defaultValue="Pending signature"
        options={SIGNATURE_STATUSES}
      />
      <TextField
        label="Uploaded by"
        name="uploadedBy"
        required
        placeholder="Adv. Brian Kiptoo"
      />
      <TextField
        wide
        label="Tags"
        name="tags"
        placeholder="contract, commercial, draft"
        hint="Separate tags with commas."
      />
    </FormDialog>
  );
}
