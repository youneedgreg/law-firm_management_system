"use client";

import { useAppState } from "@/components/AppState";
import { FormDialog } from "@/components/FormDialog";
import { SelectField, TextField } from "@/components/form";
import { TableWrap } from "@/components/ui";
import { PORTAL_CLIENT, portalCases, portalDocuments } from "@/lib/data/portal";
import { DOCUMENTS } from "@/lib/data/documents";
import { today } from "@/lib/format";
import { nextId, text } from "@/lib/forms";
import { DOCUMENT_CATEGORIES, type DocumentCategory } from "@/lib/types";

/** Case numbers this client is allowed to see documents on. */
function ownCaseNumbers(): string[] {
  return portalCases().map((legalCase) => legalCase.number);
}

export function PortalDocumentTable() {
  const { records } = useAppState();
  const own = ownCaseNumbers();
  const documents = [
    ...records.documents.filter((document) => own.includes(document.case)),
    ...portalDocuments(),
  ];

  return (
    <TableWrap>
      <table className="table">
        <thead>
          <tr>
            <th>Document</th>
            <th>Case</th>
            <th>Category</th>
            <th>Uploaded</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {documents.map((document) => (
            <tr key={document.id}>
              <td>{document.name}</td>
              <td>{document.case}</td>
              <td>{document.category}</td>
              <td>{document.date}</td>
              <td className="cell-action">
                <button
                  type="button"
                  className="btn btn-ghost btn-icon"
                  aria-label={`Download ${document.name}`}
                >
                  <i className="ph-duotone ph-download-simple" aria-hidden />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export function PortalUploadForm() {
  const { records, add } = useAppState();
  const documents = [...DOCUMENTS, ...records.documents];

  function upload(fields: FormData) {
    const filedOn = today();

    add("documents", {
      id: nextId(documents),
      name: text(fields, "name"),
      category: text(fields, "category") as DocumentCategory,
      case: text(fields, "case"),
      version: 1,
      date: filedOn,
      // Anything a client sends in is evidence for the file, not something
      // awaiting a signature.
      sigStatus: "Final",
      versions: [{ n: 1, date: filedOn, by: PORTAL_CLIENT.contact }],
      tags: ["client upload"],
    });
  }

  return (
    <FormDialog
      title="Upload a document"
      lede="Send a document to your advocate. It is filed against the matter you choose."
      trigger="Upload"
      triggerIcon="ph-duotone ph-upload-simple"
      submitLabel="Send to firm"
      onSubmit={upload}
    >
      <TextField wide label="File" name="file" type="file" />
      <TextField
        wide
        label="Document name"
        name="name"
        required
        placeholder="e.g. Signed supply agreement.pdf"
      />
      <SelectField
        label="Case"
        name="case"
        required
        defaultValue=""
        placeholder="Select a matter"
        options={portalCases().map((legalCase) => ({
          value: legalCase.number,
          label: legalCase.title,
        }))}
      />
      <SelectField
        label="Category"
        name="category"
        required
        defaultValue=""
        placeholder="Select a category"
        options={DOCUMENT_CATEGORIES}
      />
    </FormDialog>
  );
}
