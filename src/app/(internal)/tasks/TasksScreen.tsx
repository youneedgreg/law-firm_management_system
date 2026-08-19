"use client";

import { useAppState } from "@/components/AppState";
import { FormDialog } from "@/components/FormDialog";
import { SelectField, TextField } from "@/components/form";
import { TableWrap } from "@/components/ui";
import { CASES } from "@/lib/data/cases";
import { STAFF } from "@/lib/data/firm";
import { TASKS } from "@/lib/data/work";
import { displayDate, priorityTag } from "@/lib/format";
import { nextId, text } from "@/lib/forms";
import {
  PRIORITIES,
  TASK_STATUSES,
  type Priority,
  type TaskStatus,
} from "@/lib/types";

export function TasksTable() {
  const { records } = useAppState();
  const tasks = [...records.tasks, ...TASKS];

  return (
    <TableWrap>
      <table className="table">
        <thead>
          <tr>
            <th>Task</th>
            <th>Case</th>
            <th>Assignee</th>
            <th>Priority</th>
            <th>Due</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.id}>
              <td>{task.title}</td>
              <td>{task.case}</td>
              <td>{task.assignee}</td>
              <td>
                <span className={priorityTag(task.priority)}>
                  {task.priority}
                </span>
              </td>
              <td>{task.due}</td>
              <td>{task.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export function NewTaskForm() {
  const { records, add } = useAppState();
  const cases = CASES;
  const tasks = [...TASKS, ...records.tasks];

  function createTask(fields: FormData) {
    add("tasks", {
      id: nextId(tasks),
      title: text(fields, "title"),
      case: text(fields, "case"),
      assignee: text(fields, "assignee"),
      priority: text(fields, "priority") as Priority,
      due: displayDate(text(fields, "due")),
      status: text(fields, "status") as TaskStatus,
    });
  }

  return (
    <FormDialog
      title="New task"
      lede="Work assigned to a member of the firm, against the matter it belongs to."
      trigger="New task"
      triggerIcon="ph-duotone ph-plus"
      submitLabel="Create task"
      onSubmit={createTask}
    >
      <TextField
        wide
        label="Task"
        name="title"
        required
        placeholder="e.g. Draft affidavit"
      />
      <SelectField
        label="Case"
        name="case"
        required
        defaultValue=""
        placeholder="Select a case"
        options={[
          ...cases.map((legalCase) => ({
            value: legalCase.number,
            label: `${legalCase.number} — ${legalCase.title}`,
          })),
          { value: "—", label: "No case (firm admin)" },
        ]}
      />
      <SelectField
        label="Assignee"
        name="assignee"
        required
        defaultValue=""
        placeholder="Select a person"
        options={STAFF.map((member) => member.name)}
      />
      <SelectField
        label="Priority"
        name="priority"
        defaultValue="Medium"
        options={PRIORITIES}
      />
      <TextField label="Due date" name="due" type="date" required />
      <SelectField
        wide
        label="Status"
        name="status"
        defaultValue="Not started"
        options={TASK_STATUSES}
      />
    </FormDialog>
  );
}
