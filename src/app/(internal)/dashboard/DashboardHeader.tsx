"use client";

import { useRxValue } from "@effect-rx/rx-react";
import { useInvoiceStatus } from "@/rx/hooks";
import { useSession } from "@/components/Session";
import { roleLabel } from "@/domain/identity/principal";
import { recordsRx } from "@/rx/session";
import { Stat } from "@/components/ui";
import { CASES } from "@/lib/data/cases";
import { HEARINGS } from "@/lib/data/hearings";
import {
  INVOICES,
  REVENUE_THIS_MONTH,
  TRUST_ON_HAND,
} from "@/lib/data/billing";
import { PENDING_TASK_COUNT } from "@/lib/data/work";
import { kes } from "@/lib/format";

/**
 * The masthead and stat band. Both read the current role, so they run on the
 * client; everything below them on the dashboard is static and stays on the
 * server.
 */
export function DashboardHeader() {
  const { principal } = useSession();
  const isAdvocate =
    principal._tag === "Staff" && principal.role === "Advocate";

  return (
    <>
      <h1 className="page-title">
        {isAdvocate
          ? `Good day, ${principal.name.replace("Adv. ", "")}`
          : `${roleLabel(principal)} dashboard`}
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
  const { principal } = useSession();
  const records = useRxValue(recordsRx);
  const statusOf = useInvoiceStatus();
  const isAdvocate =
    principal._tag === "Staff" && principal.role === "Advocate";

  // Everything the forms have created counts towards the band too.
  const cases = CASES;
  const hearings = [...records.hearings, ...HEARINGS];
  const invoices = [...records.invoices, ...INVOICES];
  const pendingTasks =
    PENDING_TASK_COUNT +
    records.tasks.filter((task) => task.status !== "Done").length;

  /**
   * An advocate's dashboard counts only their own matters.
   *
   * Matched on the signed-in advocate's name rather than on the seed data's
   * `SIGNED_IN_ADVOCATE` constant, which was the prototype's stand-in for a
   * session. The rows are still `lib/data` — this band is Phase 7's to move —
   * but which of them are "mine" is now a fact about who signed in.
   */
  const scoped = isAdvocate
    ? cases.filter((legalCase) => legalCase.advocate === principal.name)
    : cases;

  const activeCases = scoped.filter(
    (legalCase) =>
      legalCase.status === "Active" || legalCase.status === "Hearing Scheduled",
  ).length;

  const unpaid = invoices.filter(
    (invoice) => statusOf(invoice) !== "Paid",
  ).length;

  return (
    <div className="stat-grid stat-grid-ruled">
      <Stat label="Active cases" value={activeCases} tone="accent" />
      <Stat label="Upcoming hearings" value={hearings.length} />
      <Stat label="Pending tasks" value={pendingTasks} />
      <Stat label="Unpaid invoices" value={unpaid} tone="accent-2" />
      <Stat label="Revenue (Aug)" value={kes(REVENUE_THIS_MONTH)} />
      <Stat label="Trust balance" value={kes(TRUST_ON_HAND)} />
    </div>
  );
}
