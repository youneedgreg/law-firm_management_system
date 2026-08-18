import { TableWrap } from "@/components/ui";
import { TIME_ENTRIES, TOTAL_BILLABLE_HOURS } from "@/lib/data/work";
import { billableTag } from "@/lib/format";

export default function TimeTrackingPage() {
  return (
    <>
      <h1 className="page-title">Time Tracking</h1>
      <p className="page-subtitle">
        Research, court attendance, drafting and consultation time, logged
        against the matter that will be billed for it.
      </p>

      <TableWrap>
        <table className="table">
          <thead>
            <tr>
              <th>Case</th>
              <th>Lawyer</th>
              <th>Activity</th>
              <th>Start</th>
              <th>End</th>
              <th>Hours</th>
              <th>Billable</th>
            </tr>
          </thead>
          <tbody>
            {TIME_ENTRIES.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.case}</td>
                <td>{entry.lawyer}</td>
                <td>{entry.activity}</td>
                <td>{entry.start}</td>
                <td>{entry.end}</td>
                <td>{entry.hours}</td>
                <td>
                  <span className={billableTag(entry.billable)}>
                    {entry.billable ? "Billable" : "Non-billable"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>

      <p style={{ marginTop: "var(--space-4)", fontSize: 15 }}>
        Total billable hours this month: <strong>{TOTAL_BILLABLE_HOURS}</strong>
      </p>
    </>
  );
}
