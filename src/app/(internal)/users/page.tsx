import { SectionTitle, TableWrap } from "@/components/ui";
import { USER_ACCOUNTS } from "@/lib/data/firm";
import { ROLE_ACCESS } from "@/lib/nav";

export default function UsersPage() {
  return (
    <>
      <h1 className="page-title">Users &amp; Permissions</h1>
      <p className="page-subtitle">
        Accounts, the role each one holds, and what that role can reach.
      </p>

      <TableWrap>
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Access</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {USER_ACCOUNTS.map((account) => (
              <tr key={account.name}>
                <td>{account.name}</td>
                <td>{account.role}</td>
                <td>{ROLE_ACCESS[account.role]}</td>
                <td>
                  <span className="tag tag-accent">{account.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>

      <SectionTitle spaced>System settings</SectionTitle>
      <div className="form-stack">
        <div className="field">
          <label htmlFor="firm-name">Firm name</label>
          <input id="firm-name" className="input" defaultValue="OKLaw Advocates" />
        </div>
        <div className="field">
          <label htmlFor="currency">Default currency</label>
          <input id="currency" className="input" defaultValue="KES" />
        </div>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend
            style={{
              fontSize: 12,
              marginBottom: 5,
              padding: 0,
              color: "color-mix(in srgb, var(--color-text) 70%, transparent)",
            }}
          >
            Notification channels
          </legend>
          <div className="seg">
            {["Email", "SMS", "WhatsApp"].map((channel) => (
              <label className="seg-opt" key={channel}>
                <input
                  type="checkbox"
                  name="channel"
                  value={channel}
                  defaultChecked={channel === "Email"}
                />
                {channel}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </>
  );
}
