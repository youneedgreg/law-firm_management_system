import { DateTime, Effect, Option } from "effect";
import * as Money from "../domain/shared/money";
import { BillingService, type Receivables } from "./billing-service";
import { type Diary, HearingService } from "./hearing-service";
import { MessageService, type Waiting } from "./message-service";
import { type CurrentUser } from "./policy";
import type { NotFound, RepositoryFailure } from "./repositories";
import { TaskService, type WorkList } from "./task-service";

/**
 * What needs attention, derived.
 *
 * ## There is no notifications table, and that is the design
 *
 * Every notice this produces is a *restatement of a fact that already exists
 * somewhere else*: a hearing on Thursday, a task overdue since Monday, a fee
 * note past its due date, a client waiting on a reply. Storing them would mean
 * keeping a second copy of each — and a copy that has to be written when the
 * fact appears, updated when it changes, and deleted when it resolves.
 *
 * The failure mode of that design is specific and familiar: a notification
 * saying "hearing tomorrow" for a hearing that was adjourned three weeks ago,
 * because the adjournment updated the hearing and nobody remembered the inbox.
 * Every stale notification anybody has ever seen is that bug. A derived feed
 * cannot have it — if the fact is gone, the notice is gone, because the notice
 * *was* the fact.
 *
 * What is given up is genuine and worth naming: **there is no "read" state and
 * no history**. You cannot dismiss a notice, and you cannot ask what you were
 * told last Tuesday. Those want a table, and the table is worth building the
 * day somebody needs them — at which point it stores *dismissals*, which is a
 * fact about a person, rather than copies of facts about the firm.
 *
 * ## Each source is read through its own service, and may refuse
 *
 * A Receptionist holds `hearing:read` and not `invoice:read`. Rather than
 * checking permissions here — a second copy of the table, which is exactly what
 * `permissionsOf` exists to prevent — each source is called and a refusal is
 * treated as "nothing from this source". The feed shows what the reader is
 * entitled to see, and a role that gains a permission gains the notices with
 * it, with nothing to update here.
 */

// ── What the screen reads ─────────────────────────────────────────────────

/**
 * How much attention it needs.
 *
 * Three levels, because two is not enough to separate "this is going wrong" from
 * "this is coming up" and four invites arguments about the middle.
 */
export const SEVERITIES = ["Overdue", "Soon", "Ahead"] as const;

export type Severity = (typeof SEVERITIES)[number];

/** Where a notice came from, so a screen can group or filter without parsing text. */
export const SOURCES = ["Hearing", "Task", "Invoice", "Message"] as const;

export type Source = (typeof SOURCES)[number];

export interface Notice {
  readonly source: Source;
  readonly severity: Severity;
  /** One line, written for the person reading it. */
  readonly text: string;
  /** What it is about, in a few words. */
  readonly detail: string;
  /** The date the notice turns on — a hearing date, a due date, a sent date. */
  readonly at: Date;
  /** Where to go and deal with it. */
  readonly href: string;
}

const RANK: Readonly<Record<Severity, number>> = {
  Overdue: 0,
  Soon: 1,
  Ahead: 2,
};

/**
 * Worst first, then by date.
 *
 * Overdue work sorts *oldest* first — the thing that has been wrong longest is
 * the most wrong. Upcoming work sorts *soonest* first, which is the opposite
 * direction and is what people expect of a diary. Getting this backwards makes
 * the top of the list the least urgent thing on it.
 */
export const bySeverity = (notices: readonly Notice[]): readonly Notice[] =>
  [...notices].sort(
    (a, b) =>
      RANK[a.severity] - RANK[b.severity] ||
      (a.severity === "Overdue"
        ? a.at.getTime() - b.at.getTime()
        : a.at.getTime() - b.at.getTime()),
  );

/**
 * What each source looks like when the caller may not read it.
 *
 * Spelled out rather than reached for with a cast: an empty *shape* is what a
 * refusal means here, and writing it down keeps the compiler checking that a
 * new field on any of these has an answer for the Receptionist case too.
 */
const EMPTY_DIARY = (asAt: Date): Diary => ({
  awaitingOutcome: [],
  upcoming: [],
  past: [],
  asAt,
});

const EMPTY_WORK: WorkList = {
  overdue: [],
  dueSoon: [],
  later: [],
  openCount: 0,
};

const EMPTY_RECEIVABLES: Receivables = {
  invoices: [],
  billed: Money.zero,
  collected: Money.zero,
  outstanding: Money.zero,
  overdue: Money.zero,
};

/** How far ahead "Soon" reaches. A working week. */
const SOON_DAYS = 7;

const days = (of: number) => of * 24 * 60 * 60 * 1000;

const startOfDay = (at: Date): Date =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));

/** `Soon` within the week, `Ahead` beyond it. Never `Overdue` — that is decided by the source. */
const upcoming = (at: Date, asAt: Date): Severity =>
  at.getTime() <= startOfDay(asAt).getTime() + days(SOON_DAYS)
    ? "Soon"
    : "Ahead";

const on = (date: Date) =>
  date.toLocaleDateString("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

/**
 * Nothing from a source the caller may not read.
 *
 * A refusal is not an error here: the feed is "what you should look at", and
 * for a Receptionist that legitimately excludes every figure in the firm.
 *
 * Written out at each call site rather than behind one generic helper. A
 * wrapper polymorphic in the error channel needs a cast to convince the
 * compiler it removed `NotPermitted`, and a cast to hide four short lines is a
 * bad trade — especially in the function whose whole job is to be careful about
 * which errors are swallowed.
 */
const nothing =
  <A>(empty: A) =>
  () =>
    Effect.succeed(empty);

export class NoticeService extends Effect.Service<NoticeService>()(
  "NoticeService",
  {
    effect: Effect.gen(function* () {
      const hearings = yield* HearingService;
      const tasks = yield* TaskService;
      const billing = yield* BillingService;
      const messages = yield* MessageService;

      return {
        /**
         * Everything worth looking at, worst first.
         *
         * **One clock reading**, shared by all four sources, for the reason the
         * work list and the diary both give: a feed assembled from four
         * different `now()`s can show a task as overdue and the hearing it
         * relates to as upcoming, which is a contradiction somebody will spend
         * ten minutes on.
         */
        feed: (): Effect.Effect<
          readonly Notice[],
          NotFound | RepositoryFailure,
          CurrentUser
        > =>
          Effect.gen(function* () {
            const now = yield* DateTime.nowAsDate;

            const [diary, work, receivables, waiting] = yield* Effect.all(
              [
                hearings
                  .diary()
                  .pipe(
                    Effect.catchTag("NotPermitted", nothing(EMPTY_DIARY(now))),
                  ),
                tasks
                  .workList()
                  .pipe(Effect.catchTag("NotPermitted", nothing(EMPTY_WORK))),
                billing
                  .receivables()
                  .pipe(
                    Effect.catchTag("NotPermitted", nothing(EMPTY_RECEIVABLES)),
                  ),
                messages
                  .waiting()
                  .pipe(
                    Effect.catchTag(
                      "NotPermitted",
                      nothing<readonly Waiting[]>([]),
                    ),
                  ),
              ],
              { concurrency: "unbounded" },
            );

            const notices: Notice[] = [];

            // ── Court dates ─────────────────────────────────────────────
            {
              const day = diary;
              /**
               * A past hearing with nothing recorded is the single most urgent
               * thing this firm can be told: it is either an administrative gap
               * or a missed attendance, and the difference matters before the
               * other side raises it.
               */
              for (const entry of day.awaitingOutcome) {
                notices.push({
                  source: "Hearing",
                  severity: "Overdue",
                  text: `No outcome recorded for ${entry.matterNumber}`,
                  detail: `${entry.hearing.kind} on ${on(entry.hearing.scheduledFor)} — was it attended?`,
                  at: entry.hearing.scheduledFor,
                  href: `/cases/${entry.hearing.caseId}`,
                });
              }

              for (const entry of day.upcoming) {
                notices.push({
                  source: "Hearing",
                  severity: upcoming(entry.hearing.scheduledFor, now),
                  text: `${entry.matterNumber} in court`,
                  detail: `${entry.hearing.kind} · ${entry.courtName} · ${entry.advocateName}`,
                  at: entry.hearing.scheduledFor,
                  href: `/calendar`,
                });
              }
            }

            // ── Work ────────────────────────────────────────────────────
            {
              const list = work;
              for (const entry of list.overdue) {
                notices.push({
                  source: "Task",
                  severity: "Overdue",
                  text: entry.task.title,
                  detail: `${entry.assigneeName} · due ${on(entry.task.dueOn)}${
                    Option.isSome(entry.matter)
                      ? ` · ${entry.matter.value.number}`
                      : " · firm work"
                  }`,
                  at: entry.task.dueOn,
                  href: "/tasks",
                });
              }

              for (const entry of list.dueSoon) {
                notices.push({
                  source: "Task",
                  severity: "Soon",
                  text: entry.task.title,
                  detail: `${entry.assigneeName} · due ${on(entry.task.dueOn)}`,
                  at: entry.task.dueOn,
                  href: "/tasks",
                });
              }
            }

            /**
             * ── Money ──────────────────────────────────────────────────
             *
             * `Overdue` is the *derived* status on the view, not a comparison
             * made here: whether a fee note is overdue is a billing rule, and
             * restating it would be a second copy that eventually disagrees.
             */
            for (const view of receivables.invoices) {
              if (view.status !== "Overdue") continue;

              notices.push({
                source: "Invoice",
                severity: "Overdue",
                text: `${view.invoice.number} is overdue`,
                detail: `${String(view.daysOverdue)} days · ${Money.format(view.outstanding)} outstanding`,
                at: view.invoice.dueOn,
                href: `/billing/invoices/${view.invoice.id}`,
              });
            }

            // ── Correspondence ──────────────────────────────────────────
            for (const client of waiting) {
              notices.push({
                source: "Message",
                /**
                 * A client waiting more than a working day is overdue; less
                 * than that is simply the day's work. The threshold is a
                 * judgement and is stated rather than tuned: a firm that
                 * answers within the day is doing well, and a feed that shouted
                 * about every message would be turned off.
                 */
                severity: client.hours >= 24 ? "Overdue" : "Soon",
                text: `${client.clientName} is waiting on a reply`,
                detail: `${
                  client.hours < 48
                    ? `${String(client.hours)} hours`
                    : `${String(Math.floor(client.hours / 24))} days`
                }${client.seen ? " · read, and not answered" : " · not yet read"}`,
                at: client.since,
                href: `/clients/${client.clientId}`,
              });
            }

            return bySeverity(notices);
          }),
      };
    }),
  },
) {}

/** How many need attention now. What a badge counts. */
export const pressing = (notices: readonly Notice[]): number =>
  notices.filter((notice) => notice.severity === "Overdue").length;
