"use client";

import { ActionDialog } from "@/components/ActionDialog";
import { SelectField, TextField } from "@/components/form";
import type { AdvocateId, CaseId } from "@/domain/shared/ids";
import { PRIORITIES } from "@/domain/work/task";
import { raiseTask } from "./actions";
import { NO_MATTER } from "./forms";

/**
 * Raising work.
 *
 * Two absences from the prototype's version, both deliberate.
 *
 * **No status field.** A task starts `Not started` and reaches `Done` only by
 * being completed, which is what keeps the status and the completion record
 * from disagreeing. A dropdown offering `Done` would let somebody set it with
 * nobody's name against it — refused by the domain and by Postgres, so better
 * not to ask than to ask and refuse.
 *
 * **No "raised on".** A task is raised now, by definition. Letting a caller
 * choose could produce work that was overdue before it existed.
 *
 * The assignee *is* asked, and that is the opposite default from completion:
 * work is given to a named person deliberately, and finishing it is a statement
 * about yourself.
 */
export function NewTaskForm({
  matters,
  staff,
}: {
  matters: readonly {
    readonly id: CaseId;
    readonly number: string;
    readonly title: string;
  }[];
  staff: readonly { readonly id: AdvocateId; readonly name: string }[];
}) {
  const today = new Date().toISOString().slice(0, 10);

  return (
    <ActionDialog
      title="Raise a task"
      lede="Work assigned to a member of the firm, against the matter it belongs to — or against none, for firm work."
      trigger="New task"
      triggerIcon="ph-duotone ph-plus"
      submitLabel="Raise task"
      pendingLabel="Raising…"
      action={raiseTask}
    >
      {(state) => {
        const kept = (name: string, fallback = "") =>
          state.values[name] ?? fallback;

        return (
          <>
            <TextField
              wide
              label="Task"
              name="title"
              required
              defaultValue={kept("title")}
              placeholder="e.g. Draft the affidavit of service"
              error={state.fields["title"]}
            />
            <SelectField
              wide
              label="Matter"
              name="caseId"
              defaultValue={kept("caseId", NO_MATTER)}
              options={[
                /*
                  Firm work first, because it is the option people forget
                  exists. Its value is the empty string — the same thing the
                  browser sends for "nothing chosen" — so there is one way to
                  say "no matter" rather than two.
                */
                { value: NO_MATTER, label: "No matter — firm work" },
                ...matters.map((matter) => ({
                  value: matter.id,
                  label: `${matter.number} — ${matter.title}`,
                })),
              ]}
              hint="A closed matter does not carry work; reopen it first."
              error={state.fields["caseId"]}
            />
            <SelectField
              label="Assigned to"
              name="assignedTo"
              required
              defaultValue={kept("assignedTo")}
              placeholder="Select a person"
              options={staff.map((person) => ({
                value: person.id,
                label: person.name,
              }))}
              error={state.fields["assignedTo"]}
            />
            <SelectField
              label="Priority"
              name="priority"
              required
              defaultValue={kept("priority", "Medium")}
              options={[...PRIORITIES]}
              error={state.fields["priority"]}
            />
            <TextField
              wide
              label="Due"
              name="dueOn"
              type="date"
              required
              defaultValue={kept("dueOn", today)}
              min={today}
              hint="A task cannot fall due before it was raised."
              error={state.fields["dueOn"]}
            />
          </>
        );
      }}
    </ActionDialog>
  );
}
