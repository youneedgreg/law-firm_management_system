"use client";

import { useAppState } from "@/components/AppState";
import { Stat } from "@/components/ui";
import { CASES, SIGNED_IN_ADVOCATE } from "@/lib/data/cases";
import { HEARINGS } from "@/lib/data/hearings";
import { INVOICES, REVENUE_THIS_MONTH, TRUST_ON_HAND } from "@/lib/data/billing";
import { PENDING_TASK_COUNT } from "@/lib/data/work";
import { kes } from "@/lib/format";

/**
 * The masthead and stat band. Both read the current role, so they run on the
 * client; everything below them on the dashboard is static and stays on the
 * server.
 */
export function DashboardHeader() {
  const { role } = useAppState();
  const isAdvocate = role === "Advocate/Lawyer";

  return (
    <>
      <h1 className="page-title">
        {isAdvocate
          ? `Good day, ${SIGNED_IN_ADVOCATE.replace("Adv. ", "")}`
          : `${role} dashboard`}
      </h1>
      <p className="page-subtitle">
        {isAdvocate
          ? "Here's what's on your plate today."
          : "Firm-wide overview across all active matters."}
      </p>
    </>
  );
}

export function DashboardStats() {
  const { role, statusOf } = useAppState();
  const isAdvocate = role === "Advocate/Lawyer";

  // An advocate's dashboard counts only their own matters.
  const scoped = isAdvocate
    ? CASES.filter((legalCase) => legalCase.advocate === SIGNED_IN_ADVOCATE)
    : CASES;

  const activeCases = scoped.filter(
    (legalCase) =>
      legalCase.status === "Active" || legalCase.status === "Hearing Scheduled",
  ).length;

  const unpaid = INVOICES.filter(
    (invoice) => statusOf(invoice) !== "Paid",
  ).length;

  return (
    <div className="stat-grid stat-grid-ruled">
      <Stat label="Active cases" value={activeCases} tone="accent" />
      <Stat label="Upcoming hearings" value={HEARINGS.length} />
      <Stat label="Pending tasks" value={PENDING_TASK_COUNT} />
      <Stat label="Unpaid invoices" value={unpaid} tone="accent-2" />
      <Stat label="Revenue (Aug)" value={kes(REVENUE_THIS_MONTH)} />
      <Stat label="Trust balance" value={kes(TRUST_ON_HAND)} />
    </div>
  );
}
