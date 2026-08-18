import { portalCases } from "@/lib/data/portal";

export default function PortalCasesPage() {
  return (
    <>
      <h2 style={{ fontSize: 28, margin: "0 0 var(--space-4)" }}>
        Case progress
      </h2>

      {portalCases().map((legalCase) => (
        <section key={legalCase.id} style={{ marginBottom: "var(--space-6)" }}>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 20 }}>
            {legalCase.title}
          </div>
          <div
            className="dek"
            style={{ margin: "var(--space-1) 0 var(--space-3)" }}
          >
            {legalCase.court} · {legalCase.judge} · Filed {legalCase.filed}
          </div>
          <div className="tag-row">
            {legalCase.timeline.map((event) => (
              <span className="tag tag-outline" key={`${event.date}-${event.text}`}>
                {event.date} — {event.text}
              </span>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
