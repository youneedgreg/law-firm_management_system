import { TableWrap } from "@/components/ui";
import { STAFF } from "@/lib/data/firm";

export default function StaffPage() {
  return (
    <>
      <h1 className="page-title">HR &amp; Staff Management</h1>
      <p className="page-subtitle">
        Employee records, case assignments and leave balances.
      </p>

      <TableWrap>
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Active cases</th>
              <th>Leave balance</th>
            </tr>
          </thead>
          <tbody>
            {STAFF.map((member) => (
              <tr key={member.name}>
                <td>{member.name}</td>
                <td>{member.role}</td>
                <td>{member.cases}</td>
                <td>{member.leave}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </>
  );
}
