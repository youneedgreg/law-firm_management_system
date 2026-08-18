import { FirmSettingsForm, NewUserForm, UserTable } from "./UsersScreen";
import { PageHead, SectionTitle } from "@/components/ui";

export default function UsersPage() {
  return (
    <>
      <PageHead title="Users &amp; Permissions">
        <NewUserForm />
      </PageHead>
      <p className="page-subtitle">
        Accounts, the role each one holds, and what that role can reach.
      </p>

      <UserTable />

      <SectionTitle spaced>System settings</SectionTitle>
      <FirmSettingsForm />
    </>
  );
}
