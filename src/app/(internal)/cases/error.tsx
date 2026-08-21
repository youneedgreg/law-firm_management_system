"use client";

import { BackLink } from "@/components/ui";

/**
 * The cases module's error boundary.
 *
 * It catches what `run` lets through: a database that will not answer, a stored
 * row the domain refuses to decode, a bug. Everything the service can *refuse*
 * — a claim beyond the court's limit, a status move the lifecycle forbids —
 * never arrives here, because those are values the forms show. That division is
 * the point of typing failures in the first place, and this file is where you
 * can see it holding.
 *
 * `retry` re-renders the segment on the server. It is offered because the most
 * likely cause is transient: Neon scales to zero, and the first request after
 * an idle period can time out while the compute wakes.
 *
 * **This component deliberately logs nothing.** It used to, and the line was
 * worth almost nothing: what reaches a client error boundary is not the error
 * that happened. React replaces it with an opaque one carrying only a digest,
 * precisely so that a stack trace from the server cannot be read off a browser
 * console by whoever is sitting in front of it. Printing that placeholder into
 * the browser told nobody anything and left the impression the failure had been
 * recorded.
 *
 * It is recorded — on the server, by `onRequestError` in `instrumentation.ts`,
 * with the real message, the stack, the route and the same digest shown below.
 * That is why the digest is offered as a *reference* rather than as an
 * apology: it is a key into an entry that exists.
 */
export default function CasesError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <>
      <BackLink href="/dashboard">Back to the dashboard</BackLink>

      <div className="no-access">
        <i className="ph-duotone ph-warning-octagon" aria-hidden />
        <h1 className="detail-title">Could not read from the caseload</h1>
        <p className="dek">
          Something failed on the server rather than being refused by it — most
          often the database not answering in time. Nothing was written.
        </p>
        {error.digest && (
          <p className="dek">
            Reference <code>{error.digest}</code>, which appears beside the
            cause in the server log.
          </p>
        )}
        <div className="check-row" style={{ marginTop: "var(--space-4)" }}>
          <button type="button" className="btn btn-primary" onClick={retry}>
            Try again
          </button>
        </div>
      </div>
    </>
  );
}
