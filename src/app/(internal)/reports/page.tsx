import { FinancialReport } from "./FinancialReport";
import { SectionTitle } from "@/components/ui";
import { caseStatusCounts, practiceAreas } from "@/lib/data/cases";
import { TOTAL_BILLABLE_HOURS } from "@/lib/data/work";

export default function ReportsPage() {
  const byStatus = caseStatusCounts();

  const caseLines = [
    "Cases by advocate: see the Advocate workload widget on the dashboard",
    `Cases by status: ${byStatus
      .map((row) => `${row.label} (${row.count})`)
      .join(", ")}`,
    `Cases by practice area: ${practiceAreas().join(", ")}`,
  ];

  const productivityLines = [
    `Billable hours logged: ${TOTAL_BILLABLE_HOURS}`,
    "Lawyer utilization: 78% average",
    "Task completion rate: 84% on time",
  ];

  return (
    <>
      <h1 className="page-title">Reporting &amp; Analytics</h1>
      <p className="page-subtitle">
        Case, financial and productivity reporting across the practice.
      </p>

      <div className="card-grid">
        <section>
          <SectionTitle>Case reports</SectionTitle>
          {caseLines.map((line) => (
            <div className="line-muted" key={line}>
              {line}
            </div>
          ))}
        </section>

        <section>
          <SectionTitle>Financial reports</SectionTitle>
          <FinancialReport />
        </section>

        <section>
          <SectionTitle>Productivity reports</SectionTitle>
          {productivityLines.map((line) => (
            <div className="line-muted" key={line}>
              {line}
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
