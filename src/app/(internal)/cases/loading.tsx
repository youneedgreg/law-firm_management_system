/**
 * Shown while the caseload is being read.
 *
 * The matters come from Postgres on every request — there is no static
 * fallback to show in the meantime — so this is the frame the page will fill,
 * which keeps the header from jumping when it does.
 */
export default function CasesLoading() {
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Cases</h1>
      </div>
      <p className="dek">Reading the caseload…</p>
    </>
  );
}
