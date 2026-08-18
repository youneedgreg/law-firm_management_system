import { TableWrap } from "@/components/ui";
import { AUDIT_LOG } from "@/lib/data/firm";

export default function CompliancePage() {
  return (
    <>
      <h1 className="page-title">Compliance &amp; Audit</h1>
      <p className="page-subtitle">
        Logins, document changes, case updates and payments — the audit trail
        behind the firm&rsquo;s data-protection and retention obligations.
      </p>

      <TableWrap>
        <table className="table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>User</th>
              <th>Action</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {AUDIT_LOG.map((entry) => (
              <tr key={`${entry.time}-${entry.action}`}>
                <td style={{ whiteSpace: "nowrap" }}>{entry.time}</td>
                <td>{entry.user}</td>
                <td>{entry.action}</td>
                <td>{entry.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </>
  );
}
