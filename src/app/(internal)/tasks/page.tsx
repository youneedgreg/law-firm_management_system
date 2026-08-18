import { PageHead, TableWrap } from "@/components/ui";
import { TASKS } from "@/lib/data/work";
import { priorityTag } from "@/lib/format";

export default function TasksPage() {
  return (
    <>
      <PageHead title="Tasks &amp; Workflow">
        <span className="btn btn-primary">
          <i className="ph-duotone ph-plus" aria-hidden /> New task
        </span>
      </PageHead>

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
            {TASKS.map((task) => (
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
    </>
  );
}
