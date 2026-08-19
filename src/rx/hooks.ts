"use client";

import { useRxSet, useRxValue } from "@effect-rx/rx-react";
import type { Invoice, InvoiceStatus } from "../lib/types";
import type { CreatedRecords } from "./records";
import { invoiceOverridesRx, recordsRx, statusOf } from "./session";

/**
 * The three session reads that are not just "give me the atom".
 *
 * Everything else a screen wants is `useRxValue(roleRx)` or
 * `useRxSet(settingsRx)` — a hook wrapping those would only be a second name
 * for the same thing, and naming the atom at the call site is what says where
 * the value comes from. These three exist because each carries a little logic
 * that would otherwise be copied into every screen that needs it.
 */

/**
 * Files a record created by one of the forms.
 *
 * The type parameter is what earns the hook: `add("hearings", …)` accepts a
 * `Hearing` and nothing else, which a `Writable` set to a whole
 * `CreatedRecords` cannot express at the call site.
 */
export const useAddRecord = () => {
  const setRecords = useRxSet(recordsRx);

  return <K extends keyof CreatedRecords>(
    kind: K,
    record: CreatedRecords[K][number],
  ): void => {
    setRecords((previous) => ({
      ...previous,
      [kind]: [record, ...previous[kind]],
    }));
  };
};

/** The effective status of an invoice, override applied. */
export const useInvoiceStatus = (): ((invoice: Invoice) => InvoiceStatus) => {
  const overrides = useRxValue(invoiceOverridesRx);
  return (invoice) => statusOf(overrides, invoice);
};

/** Records a payment against an invoice, for the modules still on seed data. */
export const useMarkPaid = (): ((invoiceId: number) => void) => {
  const setOverrides = useRxSet(invoiceOverridesRx);

  return (invoiceId) => {
    setOverrides((previous) => ({ ...previous, [invoiceId]: "Paid" }));
  };
};
