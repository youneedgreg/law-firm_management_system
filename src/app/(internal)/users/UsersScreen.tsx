"use client";

import { useState } from "react";
import { useAppState } from "@/components/AppState";
import { FormDialog } from "@/components/FormDialog";
import {
  CheckboxGroup,
  FormActions,
  FormGrid,
  SelectField,
  TextField,
} from "@/components/form";
import { TableWrap } from "@/components/ui";
import { USER_ACCOUNTS } from "@/lib/data/firm";
import { ROLE_ACCESS } from "@/lib/nav";
import { list, text } from "@/lib/forms";
import {
  ACCOUNT_STATUSES,
  CURRENCIES,
  DATE_FORMATS,
  NOTIFICATION_CHANNELS,
  ROLES,
  TIMEZONES,
  type AccountStatus,
  type FirmSettings,
  type Role,
} from "@/lib/types";

export function UserTable() {
  const { records } = useAppState();
  const accounts = [...records.users, ...USER_ACCOUNTS];

  return (
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
          {accounts.map((account) => (
            <tr key={account.name}>
              <td>{account.name}</td>
              <td>{account.role}</td>
              <td>{ROLE_ACCESS[account.role]}</td>
              <td>
                <span
                  className={
                    account.status === "Active"
                      ? "tag tag-accent"
                      : "tag tag-neutral"
                  }
                >
                  {account.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export function NewUserForm() {
  const { add } = useAppState();

  function createUser(fields: FormData) {
    add("users", {
      name: text(fields, "name"),
      role: text(fields, "role") as Role,
      status: text(fields, "status") as AccountStatus,
    });
  }

  return (
    <FormDialog
      title="Add a user"
      lede="The role decides what the account can reach; the access column shows what that means."
      trigger="New user"
      triggerIcon="ph-duotone ph-user-plus"
      submitLabel="Add user"
      onSubmit={createUser}
    >
      <TextField
        wide
        label="Name"
        name="name"
        required
        placeholder="e.g. Adv. Mary Otieno"
      />
      <SelectField
        label="Role"
        name="role"
        required
        defaultValue=""
        placeholder="Select a role"
        options={ROLES}
      />
      <SelectField
        label="Status"
        name="status"
        defaultValue="Active"
        options={ACCOUNT_STATUSES}
      />
    </FormDialog>
  );
}

/**
 * Firm-wide settings. An inline panel rather than a dialog: these are read as
 * often as they are changed, so they stay on the page.
 */
export function FirmSettingsForm() {
  const { settings, saveSettings, hydrated } = useAppState();
  const [saved, setSaved] = useState(false);

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    saveSettings({
      firmName: text(fields, "firmName"),
      currency: text(fields, "currency") as FirmSettings["currency"],
      timezone: text(fields, "timezone") as FirmSettings["timezone"],
      dateFormat: text(fields, "dateFormat") as FirmSettings["dateFormat"],
      channels: list(fields, "channels"),
    });
    setSaved(true);
  }

  // The stored settings arrive after mount; keying on that flag lets the
  // uncontrolled fields pick up their real defaults once they do.
  return (
    <form
      key={hydrated ? "stored" : "initial"}
      className="form-panel"
      onSubmit={save}
      onChange={() => setSaved(false)}
    >
      <FormGrid>
        <TextField
          wide
          label="Firm name"
          name="firmName"
          required
          defaultValue={settings.firmName}
        />
        <SelectField
          label="Default currency"
          name="currency"
          defaultValue={settings.currency}
          options={CURRENCIES}
        />
        <SelectField
          label="Timezone"
          name="timezone"
          defaultValue={settings.timezone}
          options={TIMEZONES}
        />
        <SelectField
          label="Date format"
          name="dateFormat"
          defaultValue={settings.dateFormat}
          options={DATE_FORMATS}
        />
        <CheckboxGroup
          wide
          label="Notification channels"
          name="channels"
          options={NOTIFICATION_CHANNELS}
          checked={settings.channels}
          hint="How hearing reminders, task deadlines and invoice notices go out."
        />
      </FormGrid>

      <FormActions>
        <button type="submit" className="btn btn-primary">
          Save settings
        </button>
        {saved && (
          <span className="form-status" role="status">
            <i className="ph-duotone ph-check-circle" aria-hidden /> Settings
            saved
          </span>
        )}
      </FormActions>
    </form>
  );
}
