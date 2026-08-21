"use client";

import { ActionDialog } from "@/components/ActionDialog";
import type { CaseId } from "@/domain/shared/ids";
import { billMatter } from "./actions";

/**
 * Turning a matter's unbilled work into a fee note.
 *
 * A dialog rather than a bare button, because this is not reversible in any
 * ordinary sense: the entries are marked as billed and can no longer be
 * corrected, and undoing it means crediting the fee note. Showing the figure
 * and asking once is the cheapest possible guard against the wrong row.
 *
 * The form carries no fields. Everything the operation needs — the lines, the
 * grouping, the total — comes from what was recorded, which is exactly why this
 * is worth having: nobody types the amount, so nobody can mistype it.
 */
export function BillMatterButton({
  caseId,
  matterNumber,
  value,
}: {
  caseId: CaseId;
  matterNumber: string;
  value: string;
}) {
  const bill = billMatter.bind(null, caseId);

  return (
    <ActionDialog
      title={`Raise a fee note for ${matterNumber}`}
      lede={`Every unbilled hour on this matter, grouped by activity and rate. ${value} in total.`}
      trigger="Bill"
      triggerVariant="btn-ghost"
      submitLabel="Raise fee note"
      pendingLabel="Raising…"
      action={bill}
    >
      {(state) => (
        <p className="field-hint" style={{ gridColumn: "1 / -1" }}>
          {state.status === "refused"
            ? ""
            : "The entries will be marked as billed and can no longer be corrected. Due in 30 days; the fee note can be edited once it exists."}
        </p>
      )}
    </ActionDialog>
  );
}
