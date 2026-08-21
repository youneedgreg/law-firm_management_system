import { Effect } from "effect";
import { Empty, TableWrap } from "@/components/ui";
import { runAs } from "@/runtime/session";
import { DocumentService } from "@/services/document-service";
import { formatSize } from "../../(internal)/documents/forms";

/**
 * A client's own documents, read as that client.
 *
 * `register()` is the *same* call the firm's document screen makes, and the
 * scope is the only difference: a portal user's is `OneClient`, so the service
 * reads their matters and the documents on those, and never loads anybody
 * else's to filter afterwards. There is no `where` clause in this file to get
 * wrong — which was the point of building the scope into the service rather
 * than into each screen.
 *
 * ## The upload form is gone, deliberately
 *
 * The prototype had one, and it wrote to a browser-session store. A portal user
 * does not hold `document:write`, so this page cannot offer it — and that is a
 * decision rather than an omission: a client uploading into the matter *file*
 * is a reasonable feature and a different one, needing a quarantine, a review
 * step and a decision about what happens to a document the firm did not put
 * there. Granting the verb before any of that exists would be a claim the
 * system does not honour.
 *
 * What replaces it is the messages page, where a client *can* write. That is
 * the honest division: correspondence is open to them, the court file is not.
 */
export default async function PortalDocumentsPage() {
  const register = await runAs(
    Effect.flatMap(DocumentService, (service) => service.register()),
  );

  return (
    <>
      <h2 style={{ fontSize: 28, margin: "0 0 var(--space-4)" }}>Documents</h2>

      {register.length === 0 ? (
        <Empty>
          There are no documents on your file yet. Your advocate will add them
          as the matter progresses.
        </Empty>
      ) : (
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th>Document</th>
                <th>Matter</th>
                <th>Category</th>
                <th>Version</th>
                <th>Size</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {register.map((entry) => (
                <tr key={entry.document.id}>
                  <td className="cell-strong">{entry.document.name}</td>
                  <td>
                    {entry.matterNumber}
                    <div className="dek">{entry.matterTitle}</div>
                  </td>
                  <td>{entry.document.category}</td>
                  <td>v{entry.versionCount}</td>
                  <td>{formatSize(entry.current.sizeBytes)}</td>
                  <td className="cell-action">
                    {/*
                      The same route the firm's screen links to. It checks
                      `document:read` and the caller's scope before minting a
                      signed URL, so a client following it gets their own
                      document and a 404 for anything else — there is no
                      separate "portal download" to keep in step.
                    */}
                    <a
                      className="btn btn-ghost btn-sm"
                      href={`/documents/${entry.document.id}/download`}
                    >
                      <i
                        className="ph-duotone ph-download-simple"
                        aria-hidden
                      />
                      Download
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}

      <p className="dek" style={{ marginTop: "var(--space-5)" }}>
        To send us a document, message your advocate and they will add it to the
        file.
      </p>
    </>
  );
}
