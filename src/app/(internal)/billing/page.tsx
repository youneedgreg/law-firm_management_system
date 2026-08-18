import { BillingStats, InvoiceTable } from "./BillingTables";
import { PageHead, SectionTitle, TableWrap } from "@/components/ui";
import { FEE_STRUCTURES, TRUST_ACCOUNTS } from "@/lib/data/billing";
import { kes } from "@/lib/format";

export default function BillingPage() {
  return (
    <>
      <PageHead title="Billing &amp; Accounting">
        <span className="btn btn-primary">
          <i className="ph-duotone ph-file-plus" aria-hidden /> New invoice
        </span>
      </PageHead>

      <BillingStats />

      <SectionTitle>Invoices</SectionTitle>
      <InvoiceTable />

      <SectionTitle spaced>Trust accounts</SectionTitle>
      <p className="dek" style={{ marginBottom: "var(--space-2)" }}>
        Client money held on trust, reconciled separately from firm revenue.
      </p>
      <TableWrap>
        <table className="table">
          <thead>
            <tr>
              <th>Client</th>
              <th>Deposits</th>
              <th>Withdrawals</th>
              <th>Balance</th>
            </tr>
          </thead>
          <tbody>
            {TRUST_ACCOUNTS.map((account) => (
              <tr key={account.client}>
                <td>{account.client}</td>
                <td>{kes(account.deposits)}</td>
                <td>{kes(account.withdrawals)}</td>
                <td className="cell-strong">{kes(account.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>

      <SectionTitle spaced>Fee structures on file</SectionTitle>
      <div className="tag-row">
        {FEE_STRUCTURES.map((structure) => (
          <span className="tag tag-outline" key={structure}>
            {structure}
          </span>
        ))}
      </div>
    </>
  );
}
