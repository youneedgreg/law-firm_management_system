import { Effect } from "effect";
import { PageHead, SectionTitle, TableWrap } from "@/components/ui";
import { ROLES } from "@/domain/firm/advocate";
import { permissionsForRole } from "@/domain/identity/permissions";
import { runAs } from "@/runtime/session";
import { FirmService } from "@/services/firm-service";

/**
 * Accounts and what each role may do.
 *
 * ## The permission table is the page
 *
 * The prototype showed a hand-written sentence per role — "Full access",
 * "Matters and time" — from `lib/nav.ts`. It is now the actual grants, read
 * from the same `BY_ROLE` table every service enforces with. A description of
 * permissions written separately from the permissions is a description that
 * goes wrong, and this is a page whose entire purpose is to be trusted about
 * what a role can reach.
 *
 * `permissionsForRole` was added for this: `permissionsOf` takes a *principal*,
 * because that is what every enforcement site has, and asking it "what does
 * this role mean" meant inventing a fake person to ask with — a cast around a
 * type that was telling the truth.
 *
 * ## Two things the prototype offered that are gone
 *
 * **"New user" is gone.** Accounts are provisioned by the seed and sign-up is
 * closed (D-5); a form that added a name to a browser store while the real
 * login table sat untouched was showing an account that could not sign in. Real
 * provisioning needs a credential, which is a deliberate act and not a dialog
 * on a settings page.
 *
 * **Firm settings are gone.** The panel offered a default currency, a timezone,
 * a date format and notification channels — and *nothing in this system read
 * any of them*. Money is Kenyan shillings because `Money.format` says so, dates
 * are `en-KE` at every call site, and there are no notification channels
 * because notices are derived and never sent. A settings form where every field
 * is inert is a form that lies, and the same reasoning that removed the leave
 * column and the portal's upload button removes this.
 */
export default async function UsersPage() {
  const roster = await runAs(
    Effect.flatMap(FirmService, (service) => service.roster()),
  );

  return (
    <>
      <PageHead title="Users &amp; Permissions" />
      <p className="page-subtitle">
        Accounts, the role each one holds, and exactly what that role may do
        &mdash; read from the same table the services enforce with.
      </p>

      <SectionTitle>Accounts</SectionTitle>
      <TableWrap>
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Email</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {roster.staff.map(({ advocate }) => (
              <tr key={advocate.id}>
                <td className="cell-strong">{advocate.name}</td>
                <td>{advocate.role}</td>
                <td>{advocate.email}</td>
                <td>
                  <span
                    className={
                      advocate.active ? "tag tag-accent" : "tag tag-neutral"
                    }
                  >
                    {advocate.active ? "Active" : "Left the firm"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>

      <SectionTitle spaced>What each role may do</SectionTitle>
      <p className="dek" style={{ marginBottom: "var(--space-3)" }}>
        Generated from the permission table itself, so it cannot drift from what
        is enforced. Read down the column rather than across: the interesting
        entries are the absences. A Receptionist sees no figure in the firm; a
        Finance Officer moves the money and cannot move a matter; a System
        Administrator manages logins and is deliberately not a superuser.
      </p>
      <TableWrap>
        <table className="table">
          <thead>
            <tr>
              <th>Role</th>
              <th>Permissions</th>
            </tr>
          </thead>
          <tbody>
            {ROLES.map((role) => (
              <tr key={role}>
                <td className="cell-strong">{role}</td>
                <td>
                  <div className="tag-row">
                    {permissionsForRole(role).map((permission) => (
                      <span className="tag tag-outline" key={permission}>
                        {permission}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </>
  );
}
