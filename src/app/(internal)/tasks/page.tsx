import Link from "next/link";
import { Effect, Option } from "effect";
import {
  Empty,
  PageHead,
  SectionTitle,
  Stat,
  TableWrap,
} from "@/components/ui";
import { may } from "@/domain/identity/permissions";
import type { TaskSummary } from "@/services/task-service";
import { priorityTag } from "@/lib/format";
import { runAs, signedIn } from "@/runtime/session";
import { TaskService } from "@/services/task-service";
import { NewTaskForm } from "./NewTaskForm";
import { CompleteButton } from "./TaskActions";

/**
 * The firm's work list, read from Postgres.
 *
 * ## Three lists, and the order they are in
 *
 * **Overdue first**, above everything, for the same reason `awaitingOutcome`
 * sits above the court diary: it is the only one that is urgent, and putting
 * the full list first — which is what a task screen normally does — buries it
 * under work that is merely pending.
 *
 * The split is made by the *server*, from one read and one clock reading. It
 * would have been easy to send one array and filter in the browser, and it
 * would have been wrong: the boundary between overdue and due-soon is the start
 * of a day, and a browser applying its own clock would disagree with the server
 * about a task due today for every user outside UTC. A task cannot appear in
 * two lists or in none, because `later` is what is left after the other two.
 *
 * ## What is deliberately absent
 *
 * No "Done" tab. Completed work leaves this screen entirely and is answered for
 * on the matter file and in the audit trail — a work list that also shows
 * finished work is a list where the finished work eventually outnumbers the
 * rest, and people stop reading it.
 */
export default async function TasksPage() {
  const principal = await signedIn();
  const mayWrite = may(principal, "task:write");

  const [list, choices] = await runAs(
    Effect.all(
      [
        Effect.flatMap(TaskService, (service) => service.workList()),
        mayWrite
          ? Effect.flatMap(TaskService, (service) => service.choices())
          : Effect.succeed(undefined),
      ],
      { concurrency: "unbounded" },
    ),
  );

  return (
    <>
      <PageHead title="Tasks &amp; Workflow">
        {choices === undefined ? null : (
          <NewTaskForm matters={choices.matters} staff={choices.staff} />
        )}
      </PageHead>
      <p className="page-subtitle">
        Work outstanding across the firm, and against no matter at all where it
        belongs to nobody&rsquo;s file. A matter cannot be closed while work on
        it is still open &mdash; closing does not delete tasks, it hides them.
      </p>

      <div className="stat-grid" style={{ marginBottom: "var(--space-6)" }}>
        <Stat label="Open" value={String(list.openCount)} small />
        {list.overdue.length > 0 ? (
          <Stat
            label="Overdue"
            value={String(list.overdue.length)}
            tone="accent-2"
            small
          />
        ) : (
          <Stat label="Overdue" value="0" small />
        )}
        <Stat
          label="Due this week"
          value={String(list.dueSoon.length)}
          tone="accent"
          small
        />
        <Stat label="Later" value={String(list.later.length)} small />
      </div>

      {list.overdue.length > 0 ? (
        <>
          <SectionTitle>Overdue</SectionTitle>
          <p className="dek" style={{ marginBottom: "var(--space-2)" }}>
            Past its due date and not done. The one list on this page that is
            urgent rather than merely pending.
          </p>
          <Tasks rows={list.overdue} mayWrite={mayWrite} />
        </>
      ) : null}

      <SectionTitle spaced>Due this week</SectionTitle>
      {list.dueSoon.length === 0 ? (
        <Empty>Nothing falls due in the next seven days.</Empty>
      ) : (
        <Tasks rows={list.dueSoon} mayWrite={mayWrite} />
      )}

      <SectionTitle spaced>Later</SectionTitle>
      {list.later.length === 0 ? (
        <Empty>No work is scheduled beyond this week.</Empty>
      ) : (
        <Tasks rows={list.later} mayWrite={mayWrite} />
      )}
    </>
  );
}

/**
 * One table, used three times.
 *
 * The three lists differ in what they mean, not in what they show, and giving
 * each its own markup is how two of them slowly stop matching the third.
 */
function Tasks({
  rows,
  mayWrite,
}: {
  rows: readonly TaskSummary[];
  mayWrite: boolean;
}) {
  return (
    <TableWrap>
      <table className="table">
        <thead>
          <tr>
            <th>Task</th>
            <th>Matter</th>
            <th>Assigned to</th>
            <th>Priority</th>
            <th>Due</th>
            <th>
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ task, matter, assigneeName }) => (
            <tr key={task.id}>
              <td className="cell-strong">{task.title}</td>
              <td>
                {/*
                  Firm work says so rather than showing a blank cell. An empty
                  cell reads as missing data; "Firm work" reads as a fact, which
                  is what it is.
                */}
                {Option.isNone(matter) ? (
                  <span className="dek">Firm work</span>
                ) : (
                  <>
                    <Link href={`/cases/${matter.value.id}`}>
                      {matter.value.number}
                    </Link>
                    <div className="dek">{matter.value.title}</div>
                  </>
                )}
              </td>
              <td>{assigneeName}</td>
              <td>
                <span className={priorityTag(task.priority)}>
                  {task.priority}
                </span>
              </td>
              <td>
                {task.dueOn.toLocaleDateString("en-KE")}
                {task.status === "In progress" ? (
                  <div className="dek">In progress</div>
                ) : null}
              </td>
              <td className="cell-action">
                {mayWrite ? (
                  <CompleteButton id={task.id} done={task.status === "Done"} />
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}
