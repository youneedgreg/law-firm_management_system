/**
 * The frame the cases segment fills.
 *
 * It covers the matter file, which is still read on the server and is the wait
 * worth showing something for. The caseload itself no longer waits here: its
 * rows are an atom, so the page renders immediately and the table says it is
 * reading — a loading state inside the component that owns it rather than a
 * whole segment replaced.
 */
export default function CasesLoading() {
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Cases</h1>
      </div>
      <p className="dek">Opening the file…</p>
    </>
  );
}
