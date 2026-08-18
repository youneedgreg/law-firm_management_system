import { TableWrap } from "@/components/ui";
import { portalDocuments } from "@/lib/data/portal";

export default function PortalDocumentsPage() {
  const documents = portalDocuments();

  return (
    <>
      <div className="page-head">
        <h2 style={{ fontSize: 28, margin: 0 }}>Documents</h2>
        <span className="btn btn-primary">
          <i className="ph-duotone ph-upload-simple" aria-hidden /> Upload
        </span>
      </div>

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
    </>
  );
}
