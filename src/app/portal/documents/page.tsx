import { PortalDocumentTable, PortalUploadForm } from "./DocumentsScreen";

export default function PortalDocumentsPage() {
  return (
    <>
      <div className="page-head">
        <h2 style={{ fontSize: 28, margin: 0 }}>Documents</h2>
        <PortalUploadForm />
      </div>

      <PortalDocumentTable />
    </>
  );
}
