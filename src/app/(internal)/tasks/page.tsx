import { NewTaskForm, TasksTable } from "./TasksScreen";
import { PageHead } from "@/components/ui";

export default function TasksPage() {
  return (
    <>
      <PageHead title="Tasks &amp; Workflow">
        <NewTaskForm />
      </PageHead>

      <TasksTable />
    </>
  );
}
