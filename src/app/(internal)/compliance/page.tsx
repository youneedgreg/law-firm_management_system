import { Effect, Option } from "effect";
import { TableWrap } from "@/components/ui";
import * as Audit from "@/domain/audit/entry";
import { runAs } from "@/runtime/session";
import { AuditLog } from "@/services/audit-service";

/**
 * The audit trail, read from the audit trail.
 *
 * It used to render `AUDIT_LOG` from `lib/data/firm.ts` — eight hand-written
 * rows that looked exactly like this and recorded nothing. Every row here was
 * written by the service that performed the action, inside the same transaction
 * as the write it describes, and cannot be edited afterwards: `audit_log` has a
 * trigger that refuses `UPDATE` and `DELETE` outright.
 *
 * A Server Component read rather than an atom. The trail is a document you come
 * to look at, like a matter file, and nothing on this page responds to anything
 * the browser does.
 */
export default async function CompliancePage() {
  const trail = await runAs(
    Effect.flatMap(AuditLog, (log) => log.trail(200)).pipe(
      /**
       * The one refusal this page renders rather than throws.
       *
       * The menu already hides `/compliance` from roles without `audit:read`,
       * so arriving here without it means a typed URL or an old bookmark —
       * which deserves a sentence, not an error boundary. The refusal itself
       * still comes from the service: this decides how to *show* it, never
       * whether it applies.
       */
      Effect.catchTag("NotPermitted", () => Effect.succeed(undefined)),
    ),
  );

  if (trail === undefined) {
    return (
      <>
        <h1 className="page-title">Compliance &amp; Audit</h1>
        <p className="page-subtitle">
          The audit trail records who did what, and is readable by a Managing
          Partner or a System Administrator. Your role does not hold that
          permission.
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className="page-title">Compliance &amp; Audit</h1>
      <p className="page-subtitle">
        Sign-ins, refused sign-ins and every change to a matter — the trail
        behind the firm&rsquo;s data-protection and retention obligations. The
        actor is recorded as they were at the time, because staff leave and
        roles are reassigned, and an entry is a statement about the past.
      </p>

      <TableWrap>
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>What</th>
              <th>Changed</th>
            </tr>
          </thead>
          <tbody>
            {trail.map((entry) => (
              <tr key={entry.id}>
                <td style={{ whiteSpace: "nowrap" }}>
                  {entry.at.toLocaleString("en-GB", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: "Africa/Nairobi",
                  })}
                </td>
                <td>
                  {entry.actor.name}
                  <span className="dek"> · {entry.actor.role}</span>
                </td>
                <td>
                  {Audit.describe(entry)}
                  {Option.match(entry.entityId, {
                    onNone: () => null,
                    onSome: (id) => (
                      <span className="dek">
                        {" "}
                        · {entry.entity} {id}
                      </span>
                    ),
                  })}
                </td>
                <td>
                  <Changed entry={entry} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>

      {trail.length === 0 && (
        <p className="dek">
          Nothing recorded yet. Sign in as somebody else, or open a matter, and
          it will appear here.
        </p>
      )}
    </>
  );
}

/**
 * The fields that moved, rather than two blobs of JSON.
 *
 * An amendment touches one field out of fifteen, and a reviewer scanning for
 * the one that moved should not have to diff by eye. The comparison is the
 * domain's — `changes` in `domain/audit/entry.ts` — because deciding what
 * counts as a change is not a rendering question.
 */
function Changed({ entry }: { entry: Audit.AuditEntry }) {
  const moved = Audit.changes(entry);

  if (moved.length === 0) return <span className="dek">—</span>;

  return (
    <ul className="audit-changes">
      {moved.map((change) => (
        <li key={change.field}>
          <strong>{change.field}</strong>: {change.from} → {change.to}
        </li>
      ))}
    </ul>
  );
}
