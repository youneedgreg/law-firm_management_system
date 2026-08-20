import { Effect } from "effect";
import { TableWrap } from "@/components/ui";
import * as Money from "@/domain/shared/money";
import { feeNoteStatusTag } from "@/lib/format";
import { runAs, signedIn } from "@/runtime/session";
import { BillingService } from "@/services/billing-service";

/**
 * A client's own fee notes.
 *
 * Read through `BillingService.forClient` with the client id taken from the
 * session rather than from the URL — there is no id in this route to tamper
 * with, and the scope check would refuse another client's anyway.
 *
 * **"Pay now" is gone, and its absence is the honest state of things.** The
 * button used to write a browser-side status override that made an invoice look
 * paid on both this screen and the firm's. Nothing was received, and after
 * Phase 2 there is a real ledger with a Rule 10 trigger over it — a button that
 * marks a fee note settled without a payment row and a trust movement would be
 * a misstatement of client money, which is precisely what the Advocates
 * (Accounts) Rules are about. Payment is Phase 7's, where M-Pesa reconciliation
 * lands with it.
 */
export default async function PortalInvoicesPage() {
  const principal = await signedIn();

  const invoices = await runAs(
    Effect.flatMap(BillingService, (service) =>
      service.forClient(
        principal._tag === "PortalUser"
          ? principal.clientId
          : // Unreachable: the portal layout redirects staff away before this
            // renders. The type has two branches, so this says which one.
            (principal.advocateId as never),
      ),
    ),
  );

  return (
    <>
      <h2 style={{ fontSize: 28, margin: "0 0 var(--space-4)" }}>Invoices</h2>

      {invoices.length === 0 ? (
        <p className="dek">No fee notes have been raised on your matters.</p>
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
              </tr>
            </thead>
            <tbody>
              {invoices.map(({ invoice, total, outstanding, status }) => (
                <tr key={invoice.id}>
                  <td>{invoice.number}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {invoice.issuedOn.toLocaleDateString("en-GB")}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {invoice.dueOn.toLocaleDateString("en-GB")}
                  </td>
                  <td>{Money.format(total)}</td>
                  <td>{Money.format(outstanding)}</td>
                  <td>
                    <span className={feeNoteStatusTag(status)}>{status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}

      <p className="dek" style={{ marginTop: "var(--space-4)" }}>
        To settle a fee note, talk to the firm — online payment and M-Pesa
        reconciliation are not built yet.
      </p>
    </>
  );
}
