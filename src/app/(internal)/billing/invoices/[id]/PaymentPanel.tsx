"use client";

import { ActionDialog } from "@/components/ActionDialog";
import { SelectField, TextField } from "@/components/form";
import { PAYMENT_METHODS } from "@/domain/billing/invoice";
import type { InvoiceId } from "@/domain/shared/ids";
import * as Money from "@/domain/shared/money";
import { recordPayment, settleFromTrust } from "../../actions";

/**
 * The two ways a fee note gets paid, side by side.
 *
 * They are two dialogs rather than one form with a "pay from trust" tick box,
 * because they are two different acts under the Advocates (Accounts) Rules and
 * the paperwork differs. Recording a payment says money arrived from the client;
 * settling says the firm took its costs out of money it was already holding —
 * a Rule 9 transfer to office account, which is a withdrawal from client
 * account and appears as one on the ledger and in the audit trail.
 *
 * Neither dialog decides anything. The overpayment guard, the duplicate M-Pesa
 * confirmation and Rule 10 are all enforced behind them, and each arrives back
 * as a sentence beside the form. What this file *does* decide is what to offer,
 * and the settlement dialog is withheld when the client's balance cannot cover
 * the outstanding amount — an affordance, not a control: the service still
 * refuses if the figures move between render and submit, which is exactly what
 * two clerks working at once looks like.
 */
export function PaymentPanel({
  invoiceId,
  outstanding,
  heldOnTrust,
  mayRecordPayment,
  mayMoveMoney,
}: {
  invoiceId: InvoiceId;
  outstanding: Money.Money;
  heldOnTrust?: Money.Money | undefined;
  mayRecordPayment: boolean;
  mayMoveMoney: boolean;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const settled = !Money.isPositive(outstanding);

  const record = recordPayment.bind(null, invoiceId);
  const settle = settleFromTrust.bind(null, invoiceId);

  /**
   * How much of the outstanding balance client money could cover.
   *
   * Shown rather than assumed: a firm settling KES 130,000 of costs against a
   * client holding KES 90,000 wants to see the 90,000, not a refusal after
   * typing. The figure is absent entirely for a caller without `trust:read`,
   * and the panel then offers no settlement at all.
   */
  const coverable =
    heldOnTrust === undefined
      ? undefined
      : Money.lessThan(heldOnTrust, outstanding)
        ? heldOnTrust
        : outstanding;

  if (settled || !mayRecordPayment) {
    return settled ? (
      <p className="dek" style={{ marginTop: "var(--space-5)" }}>
        Nothing further is owing on this fee note.
      </p>
    ) : null;
  }

  return (
    <div className="action-row" style={{ marginTop: "var(--space-5)" }}>
      <ActionDialog
        title="Record a payment"
        lede="Money received from the client — a cheque, a bank transfer, or an M-Pesa confirmation."
        trigger="Record payment"
        triggerIcon="ph-duotone ph-hand-coins"
        submitLabel="Record payment"
        pendingLabel="Recording…"
        action={record}
      >
        {(state) => {
          const kept = (name: string, fallback = "") =>
            state.values[name] ?? fallback;

          return (
            <>
              <TextField
                label="Amount (KES)"
                name="amount"
                type="number"
                min="0"
                step="0.01"
                required
                defaultValue={kept("amount", String(outstanding / 100))}
                hint={`${Money.format(outstanding)} outstanding.`}
                error={state.fields["amount"]}
              />
              <TextField
                label="Received"
                name="receivedOn"
                type="date"
                required
                defaultValue={kept("receivedOn", today)}
                error={state.fields["receivedOn"]}
              />
              <SelectField
                label="Method"
                name="method"
                required
                defaultValue={kept("method", "M-Pesa")}
                options={[...PAYMENT_METHODS]}
                error={state.fields["method"]}
              />
              <TextField
                label="Reference"
                name="reference"
                defaultValue={kept("reference")}
                placeholder="e.g. QGH7XYZ12A"
                hint="Required for M-Pesa: the confirmation code is the only thing the statement reconciles against."
                error={state.fields["reference"]}
              />
            </>
          );
        }}
      </ActionDialog>

      {mayMoveMoney &&
      coverable !== undefined &&
      Money.isPositive(coverable) ? (
        <ActionDialog
          title="Settle from client money"
          lede="Transfers the firm's costs out of the money already held for this client. A withdrawal from client account under Rule 9."
          trigger="Settle from trust"
          triggerIcon="ph-duotone ph-vault"
          triggerVariant="btn-ghost"
          submitLabel="Transfer costs"
          pendingLabel="Transferring…"
          action={settle}
        >
          {(state) => {
            const kept = (name: string, fallback = "") =>
              state.values[name] ?? fallback;

            return (
              <>
                <TextField
                  label="Amount (KES)"
                  name="amount"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  defaultValue={kept("amount", String(coverable / 100))}
                  hint={`${Money.format(heldOnTrust ?? Money.zero)} held for this client; ${Money.format(outstanding)} outstanding.`}
                  error={state.fields["amount"]}
                />
                <TextField
                  label="Transferred"
                  name="settledOn"
                  type="date"
                  required
                  defaultValue={kept("settledOn", today)}
                  error={state.fields["settledOn"]}
                />
              </>
            );
          }}
        </ActionDialog>
      ) : null}
    </div>
  );
}
