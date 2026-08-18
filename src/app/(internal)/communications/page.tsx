import { COMMUNICATIONS } from "@/lib/data/firm";

export default function CommunicationsPage() {
  return (
    <>
      <h1 className="page-title">Communications</h1>
      <p className="page-subtitle">
        Every email, call, SMS, WhatsApp message and meeting logged against the
        client it concerns.
      </p>

      {COMMUNICATIONS.map((entry) => (
        <div className="row row-icon" key={entry.id}>
          <i className={`${entry.icon} ink-accent`} aria-hidden />
          <div>
            <div style={{ fontSize: 14 }}>
              <strong>{entry.channel}</strong> — {entry.with}
            </div>
            <div className="row-meta">
              {entry.summary} · {entry.date}
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
