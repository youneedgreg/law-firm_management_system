import Link from "next/link";
import { Effect } from "effect";
import { may } from "@/domain/identity/permissions";
import * as Money from "@/domain/shared/money";
import {
  Empty,
  PageHead,
  SectionTitle,
  Stat,
  TableWrap,
} from "@/components/ui";
import { runAs, signedIn } from "@/runtime/session";
import { BillingService } from "@/services/billing-service";
import { feeNoteStatusTag } from "@/lib/format";
import { NewInvoiceForm } from "./NewInvoiceForm";
import { NewDepositForm } from "./NewDepositForm";

/**
 * Billing, read from Postgres.
 *
 * A Server Component rather than an atom, and the reasoning is Phase 5's own:
 * filtering is interaction and belongs to the browser, but this page is a
 * *document*. It is the firm's receivables as at now, it is what somebody
 * prints on the first of the month, and it changes when the money changes
 * rather than in response to anything the browser does. One in-process read, no
 * HTTP hop.
 *
 * ## The two sections, and why one of them can be missing
 *
 * `receivables()` returns the client account only to a caller who holds
 * `trust:read` *and* whose scope is the whole firm — and it returns it as an
 * absent field rather than an empty list to anyone else. This page renders that
 * distinction rather than flattening it: an Advocate sees the fee notes and no
 * client-account section at all, which is the truth. A section headed "Trust
 * accounts" above an empty table would tell a Receptionist that the firm holds
 * no client money, which is both false and exactly the kind of false a
 * reconciliation screen must never be.
 *
 * The write affordances follow the same table the service enforces with, read
 * through `may`. This is a UI decision and not a control — `BillingService`
 * refuses regardless — but a button rendered for somebody who will be refused
 * on click is a worse experience than one that was never drawn.
 */
export default async function BillingPage() {
  const principal = await signedIn();

  const mayWrite = may(principal, "invoice:write");
  const mayMoveMoney = may(principal, "trust:write");

  /**
   * The receivables, and — only for a caller who can raise a fee note — the
   * clients and matters to raise one against.
   *
   * `choices()` is gated on `invoice:write`, so asking for it unconditionally
   * would fail the whole page for an Advocate who is entitled to the first
   * half. Guarding the call rather than catching the refusal keeps the
   * permission check in one place: the service decides, and this decides
   * whether to ask.
   */
  const [receivables, choices] = await runAs(
    Effect.all(
      [
        Effect.flatMap(BillingService, (billing) => billing.receivables()),
        mayWrite
          ? Effect.flatMap(BillingService, (billing) => billing.choices())
          : Effect.succeed(undefined),
      ],
      { concurrency: "unbounded" },
    ),
  );

  return (
    <>
      <PageHead title="Billing &amp; Accounting">
        {choices === undefined ? null : <NewInvoiceForm choices={choices} />}
      </PageHead>

      <div className="stat-grid" style={{ marginBottom: "var(--space-6)" }}>
        <Stat
          label="Total billed"
          value={Money.format(receivables.billed)}
          small
        />
        <Stat
          label="Collected"
          value={Money.format(receivables.collected)}
          tone="accent"
          small
        />
        <Stat
          label="Outstanding"
          value={Money.format(receivables.outstanding)}
          tone="accent-2"
          small
        />
        {receivables.trustHeld === undefined ? (
          <Stat
            label="Overdue"
            value={Money.format(receivables.overdue)}
            small
          />
        ) : (
          <Stat
            label="Trust on hand"
            value={Money.format(receivables.trustHeld)}
            small
          />
        )}
      </div>

      <SectionTitle>Invoices</SectionTitle>
      {receivables.invoices.length === 0 ? (
        <Empty>No fee notes have been raised.</Empty>
      ) : (
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Issued</th>
                <th>Due</th>
                <th>Total</th>
                <th>Outstanding</th>
                <th>Status</th>
                <th>
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {receivables.invoices.map((view) => (
                <tr key={view.invoice.id}>
                  <td>{view.invoice.number}</td>
                  <td>{view.invoice.issuedOn.toLocaleDateString("en-KE")}</td>
                  <td>{view.invoice.dueOn.toLocaleDateString("en-KE")}</td>
                  <td>{Money.format(view.total)}</td>
                  <td className="cell-strong">
                    {Money.format(view.outstanding)}
                  </td>
                  <td>
                    <span className={feeNoteStatusTag(view.status)}>
                      {view.status}
                    </span>
                    {view.daysOverdue > 0 ? (
                      <span className="dek"> · {view.daysOverdue}d</span>
                    ) : null}
                  </td>
                  <td className="cell-action">
                    <Link
                      href={`/billing/invoices/${view.invoice.id}`}
                      className="btn btn-ghost"
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}

      {/*
        Absent, not empty. See the note at the top of this file: a caller
        without `trust:read` gets no field, and rendering a heading over
        nothing would make "you were not shown this" look like "there is
        nothing to show".
      */}
      {receivables.trust === undefined ? null : (
        <>
          <div className="page-head" style={{ marginTop: "var(--space-6)" }}>
            <SectionTitle spaced={false}>Client account</SectionTitle>
            {mayMoveMoney && choices !== undefined ? (
              <NewDepositForm clients={choices.clients} />
            ) : null}
          </div>
          <p className="dek" style={{ marginBottom: "var(--space-2)" }}>
            Money held on trust under the Advocates (Accounts) Rules. Never the
            firm&rsquo;s money: a balance here is an obligation to the client,
            and no client&rsquo;s balance may go below nothing (r. 10).
          </p>
          {receivables.trust.length === 0 ? (
            <Empty>The firm holds no client money.</Empty>
          ) : (
            <TableWrap>
              <table className="table">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Paid in</th>
                    <th>Paid out</th>
                    <th>Held</th>
                  </tr>
                </thead>
                <tbody>
                  {receivables.trust.map((account) => (
                    <tr key={account.clientId}>
                      <td>{account.clientName}</td>
                      <td>{Money.format(account.deposits)}</td>
                      <td>{Money.format(account.withdrawals)}</td>
                      <td className="cell-strong">
                        {Money.format(account.balance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </>
      )}
    </>
  );
}
