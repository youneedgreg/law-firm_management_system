import { Effect, Option, Schema } from "effect";
import * as Matter from "../domain/case/case";
import type { NotPermitted } from "../domain/identity/permissions";
import type { Principal } from "../domain/identity/principal";
import { AdvocateId, CaseId, TimeEntryId } from "../domain/shared/ids";
import * as Money from "../domain/shared/money";
import * as Time from "../domain/time/entry";
import { AuditLog } from "./audit-service";
import { CurrentUser, permitted, scope, withinScope } from "./policy";
import {
  AdvocateRepository,
  CaseRepository,
  type NotFound,
  NotFound as NotFoundError,
  type RepositoryFailure,
  TimeRepository,
  Transactor,
} from "./repositories";

/**
 * Recorded work, as the application uses it.
 *
 * Time is where a firm's revenue actually comes from, and this layer exists for
 * the two things the repository cannot do alone: resolve the matter reference
 * and the fee-earner's name a timesheet shows, and enforce the rules that need
 * a *stored* fact — whether the matter is still open, and whether the entry has
 * already been carried onto a fee note.
 *
 * ## You record your own time
 *
 * `record` never takes an `advocateId`. The entry is attributed to whoever is
 * asking, and there is no way to say otherwise.
 *
 * That is a real constraint rather than a simplification, and it is worth being
 * clear about what it costs and what it buys. It costs the case where a partner
 * enters a colleague's time from a handwritten note, which does happen. What it
 * buys is that **a timesheet is a first-hand record**: every entry was written
 * by the person who did the work, so "six hours drafting on the 14th" is that
 * person's own assertion and not somebody's reconstruction of it. In a fee
 * dispute the difference between those two is the whole of the difference
 * between evidence and hearsay.
 *
 * If the firm ever needs delegated entry, the honest shape is an entry that
 * records both the fee-earner and who typed it — not an `advocateId` parameter
 * that quietly loses the second.
 */

// ── What the screens read ─────────────────────────────────────────────────

/** A time entry with the two names a timesheet has to show. */
export interface TimesheetLine {
  readonly entry: Time.TimeEntry;
  readonly matterNumber: string;
  readonly matterTitle: string;
  readonly advocateName: string;
  /** What this entry is worth: zero for non-billable, by definition. */
  readonly value: Money.Money;
  readonly hours: number;
}

/**
 * A timesheet, with the figures a firm actually manages by.
 *
 * `utilisation` is the share of recorded time that is billable, and it is the
 * number that answers "where did the week go". It counts non-billable work
 * rather than ignoring it — a model that only recorded billable time could not
 * produce this figure at all, which is why `TimeEntry.billable` is a field and
 * not a filter applied before storage.
 */
export interface Timesheet {
  readonly lines: readonly TimesheetLine[];
  readonly totalMinutes: number;
  readonly billableMinutes: number;
  readonly utilisation: number;
  readonly billableValue: Money.Money;
  /** Billable work not yet on a fee note — the firm's work in progress. */
  readonly unbilledValue: Money.Money;
}

export interface TimesheetFilter {
  readonly caseId?: CaseId | undefined;
  readonly advocateId?: AdvocateId | undefined;
  /** Only work not yet carried onto a fee note. */
  readonly unbilledOnly?: boolean | undefined;
}

// ── What the boundary accepts ─────────────────────────────────────────────

/**
 * Recording work.
 *
 * `advocateId` is absent — see the note at the top of the file. `invoicedOn` is
 * absent because a caller does not decide that either: work is carried onto a
 * fee note by raising one, which is `BillingService.raiseFromTime`, and offering
 * the field here would be offering a way to mark work as billed without any fee
 * note existing.
 */
export const RecordTime = Schema.Struct({
  caseId: CaseId,
  activity: Time.Activity,
  minutes: Schema.Int.pipe(Schema.positive()),
  workedOn: Schema.DateFromSelf,
  billable: Schema.Boolean,
  hourlyRateCents: Schema.Int.pipe(Schema.nonNegative()),
  narrative: Schema.NonEmptyTrimmedString,
});

export type RecordTime = typeof RecordTime.Type;

/**
 * Correcting an entry. Every field optional; absence means leave alone.
 *
 * `caseId` is not among them. Work recorded against the wrong matter is not an
 * edit but a deletion and a re-entry, and moving it silently would take the
 * hours off one client's bill and put them on another's without either being
 * told.
 */
export const AmendTime = Schema.Struct({
  activity: Schema.optional(Time.Activity),
  minutes: Schema.optional(Schema.Int.pipe(Schema.positive())),
  workedOn: Schema.optional(Schema.DateFromSelf),
  billable: Schema.optional(Schema.Boolean),
  hourlyRateCents: Schema.optional(Schema.Int.pipe(Schema.nonNegative())),
  narrative: Schema.optional(Schema.NonEmptyTrimmedString),
});

export type AmendTime = typeof AmendTime.Type;

// ── Failures this layer adds ──────────────────────────────────────────────

/**
 * Only a fee-earner records time, and a principal without an advocate record
 * is not one.
 *
 * Unreachable through the permission table as it stands — every role that holds
 * `time:write` is staff, and staff always carry an `advocateId`. It exists so
 * that the impossible case is refused rather than assumed, because the thing
 * that makes it impossible is a table somebody may edit.
 */
export class NotAFeeEarner extends Schema.TaggedError<NotAFeeEarner>()(
  "NotAFeeEarner",
  { name: Schema.String },
) {
  get reason(): string {
    return `${this.name} has no fee-earner record, so time cannot be recorded against them`;
  }
}

/**
 * A matter that is closed does not accrue time.
 *
 * The refusal is a prompt rather than a prohibition on the work: it almost
 * always means the wrong matter was picked from a list, and on the rare
 * occasion it does not, the matter should be reopened first — which is a
 * decision with its own audit entry rather than a side effect of a timesheet.
 */
/**
 * The domain's error, re-exported as a **type only**.
 *
 * It was `export const MatterIsClosed = Matter.MatterIsClosed` — an alias
 * evaluated when the module loads — and that failed at runtime with
 * "Matter is not defined": dereferencing a namespace at module-evaluation time
 * depends on the bundler's chunk ordering, which nothing here controls.
 * Construction sites say `new Matter.MatterIsClosed(…)` instead, which is
 * resolved when it runs rather than when it loads.
 *
 * The type alias is safe because it is erased.
 */
export type MatterIsClosed = Matter.MatterIsClosed;

/** Work already on a fee note cannot be edited. */
export class BilledWorkIsFixed extends Schema.TaggedError<BilledWorkIsFixed>()(
  "BilledWorkIsFixed",
  { narrative: Schema.String },
) {
  get reason(): string {
    return (
      `"${this.narrative}" has already been carried onto a fee note. The ` +
      `client has been billed for it as it stands, so changing it now would ` +
      `make the invoice and the timesheet disagree — credit the fee note ` +
      `instead`
    );
  }
}

export type CannotRecordTime =
  NotPermitted | NotAFeeEarner | MatterIsClosed | NotFound | RepositoryFailure;

// ── Helpers ───────────────────────────────────────────────────────────────

/** The advocate record behind a principal, where there is one. */
const feeEarnerOf = (
  principal: Principal,
): Effect.Effect<AdvocateId, NotAFeeEarner> =>
  principal._tag === "Staff"
    ? Effect.succeed(principal.advocateId)
    : Effect.fail(new NotAFeeEarner({ name: principal.name }));

const entryId = (): TimeEntryId =>
  Schema.decodeSync(TimeEntryId)(crypto.randomUUID());

const applyAmendment = (
  entry: Time.TimeEntry,
  edits: AmendTime,
): Time.TimeEntry => ({
  ...entry,
  ...(edits.activity === undefined ? {} : { activity: edits.activity }),
  ...(edits.minutes === undefined ? {} : { minutes: edits.minutes }),
  ...(edits.workedOn === undefined ? {} : { workedOn: edits.workedOn }),
  ...(edits.billable === undefined ? {} : { billable: edits.billable }),
  ...(edits.hourlyRateCents === undefined
    ? {}
    : { hourlyRateCents: edits.hourlyRateCents }),
  ...(edits.narrative === undefined ? {} : { narrative: edits.narrative }),
});

// ── The service ───────────────────────────────────────────────────────────

export class TimeService extends Effect.Service<TimeService>()("TimeService", {
  effect: Effect.gen(function* () {
    const entries = yield* TimeRepository;
    const cases = yield* CaseRepository;
    const advocates = yield* AdvocateRepository;
    const audit = yield* AuditLog;
    const transactor = yield* Transactor;

    /**
     * One entry, with the caller's scope checked against the matter it is on.
     *
     * A time entry has no client of its own — it belongs to a matter, and the
     * matter belongs to a client. So the scope check is two hops, and it has to
     * be, because the alternative is a portal user reading the firm's narrative
     * of work done on somebody else's file.
     */
    const scoped = (id: TimeEntryId) =>
      Effect.gen(function* () {
        const entry = yield* entries.byId(id);
        const matter = yield* cases.byId(entry.caseId);
        yield* withinScope("time entry", id, matter.clientId);
        return { entry, matter };
      });

    return {
      /**
       * The timesheet, with names resolved.
       *
       * Three reads and an in-memory join, as `CaseService.caseload` does, and
       * for the same reason: a repository that returned entries-with-names
       * would be returning something that is not a `TimeEntry`.
       *
       * A portal user cannot reach this at all — `time:read` is not among their
       * permissions — which is deliberate and worth stating, because a client
       * *is* entitled to see the narrative behind a fee note they have been
       * sent. That is a different view, built from the invoice rather than from
       * the timesheet, and Phase 7's portal slice is where it belongs. Giving
       * the portal this one would hand a client every entry on the matter,
       * including the ones written off and the ones not yet billed.
       */
      timesheet: (
        filter: TimesheetFilter = {},
      ): Effect.Effect<
        Timesheet,
        NotPermitted | RepositoryFailure,
        CurrentUser
      > =>
        Effect.gen(function* () {
          yield* permitted("time:read");

          const recorded = yield* filter.unbilledOnly === true
            ? entries.unbilled(filter.caseId)
            : filter.caseId !== undefined
              ? entries.forCase(filter.caseId)
              : filter.advocateId !== undefined
                ? entries.forAdvocate(filter.advocateId)
                : entries.recent(200);

          const relevant = recorded.filter(
            (entry) =>
              (filter.caseId === undefined || entry.caseId === filter.caseId) &&
              (filter.advocateId === undefined ||
                entry.advocateId === filter.advocateId),
          );

          const [everyMatter, everyAdvocate] = yield* Effect.all(
            [cases.all(), advocates.all()],
            { concurrency: "unbounded" },
          );

          const matters = new Map(
            everyMatter.map((matter) => [matter.id, matter] as const),
          );
          const names = new Map(
            everyAdvocate.map(
              (advocate) => [advocate.id, advocate.name] as const,
            ),
          );

          const lines = relevant.map((entry): TimesheetLine => {
            const matter = matters.get(entry.caseId);
            return {
              entry,
              matterNumber: matter?.number ?? "—",
              matterTitle: matter?.title ?? "Unknown matter",
              advocateName: names.get(entry.advocateId) ?? "Unassigned",
              value: Time.value(entry),
              hours: Time.hours(entry),
            };
          });

          const unbilled = relevant.filter(
            (entry) => entry.billable && !Time.isInvoiced(entry),
          );

          return {
            lines,
            totalMinutes: Time.totalMinutes(relevant),
            billableMinutes: Time.totalMinutes(
              relevant.filter((entry) => entry.billable),
            ),
            utilisation: Time.utilisation(relevant),
            billableValue: Time.billableValue(relevant),
            unbilledValue: Time.billableValue(unbilled),
          } satisfies Timesheet;
        }),

      /**
       * Records work, against the caller and against an open matter.
       *
       * Both checks need a stored fact, which is why they are here rather than
       * in the domain: who the caller is, and whether the matter is still open.
       */
      record: (
        input: RecordTime,
      ): Effect.Effect<Time.TimeEntry, CannotRecordTime, CurrentUser> =>
        Effect.gen(function* () {
          const principal = yield* permitted("time:write");
          const advocateId = yield* feeEarnerOf(principal);

          const matter = yield* cases.byId(input.caseId);
          yield* withinScope("case", input.caseId, matter.clientId);

          if (matter.status === "Closed") {
            return yield* Effect.fail(
              new Matter.MatterIsClosed({
                number: matter.number,
                attempted: "record time against it",
              }),
            );
          }

          const entry: Time.TimeEntry = {
            ...input,
            id: entryId(),
            advocateId,
            invoicedOn: Option.none(),
          };

          return yield* transactor.transaction(
            Effect.gen(function* () {
              const saved = yield* entries.save(entry);
              yield* audit.record({
                action: "time.recorded",
                entity: "time",
                entityId: saved.id,
                after: saved,
              });
              return saved;
            }),
          );
        }),

      /**
       * Corrects an entry that has not been billed.
       *
       * The refusal for billed work is the interesting rule. Once time is on a
       * fee note the client has been told what they are paying for, and editing
       * the underlying entry makes the invoice and the timesheet disagree
       * about the same work — which is exactly the discrepancy a taxing master
       * looks for. The remedy is a credit note against the fee note, which is a
       * visible act rather than a silent one.
       */
      amend: (
        id: TimeEntryId,
        edits: AmendTime,
      ): Effect.Effect<
        Time.TimeEntry,
        | NotPermitted
        | BilledWorkIsFixed
        | NotAFeeEarner
        | NotFound
        | RepositoryFailure,
        CurrentUser
      > =>
        Effect.gen(function* () {
          const principal = yield* permitted("time:write");
          const { entry } = yield* scoped(id);

          if (Time.isInvoiced(entry)) {
            return yield* Effect.fail(
              new BilledWorkIsFixed({ narrative: entry.narrative }),
            );
          }

          /**
           * You correct your own entries.
           *
           * The same reasoning as `record`, applied to the other end: an entry
           * edited by somebody else is no longer that person's first-hand
           * assertion about their own work. Reported as `NotFound` rather than
           * as a refusal, because from this caller's point of view somebody
           * else's timesheet line is not theirs to know about.
           */
          const mine = yield* feeEarnerOf(principal);
          if (entry.advocateId !== mine) {
            return yield* Effect.fail(
              new NotFoundError({ entity: "time entry", id }),
            );
          }

          const amended = applyAmendment(entry, edits);

          return yield* transactor.transaction(
            Effect.gen(function* () {
              const saved = yield* entries.save(amended);
              yield* audit.record({
                action: "time.amended",
                entity: "time",
                entityId: saved.id,
                before: entry,
                after: saved,
              });
              return saved;
            }),
          );
        }),

      /**
       * Billable work on one matter that has not been carried onto a fee note.
       *
       * The read `BillingService.raiseFromTime` is built on, and the one a
       * fee-earner looks at before deciding what to bill. Gated on `time:read`
       * — a Finance Officer holds it, which is the point.
       */
      unbilledFor: (
        caseId: CaseId,
      ): Effect.Effect<
        readonly Time.TimeEntry[],
        NotPermitted | NotFound | RepositoryFailure,
        CurrentUser
      > =>
        Effect.gen(function* () {
          yield* permitted("time:read");
          const matter = yield* cases.byId(caseId);
          yield* withinScope("case", caseId, matter.clientId);
          return yield* entries.unbilled(caseId);
        }),

      /**
       * The firm's work in progress: billable time not yet billed, by matter.
       *
       * The single most useful number a small practice does not usually have.
       * Scoped to the whole firm and therefore staff-only, which `scope` makes
       * explicit rather than assuming.
       */
      workInProgress: (): Effect.Effect<
        readonly {
          readonly caseId: CaseId;
          readonly matterNumber: string;
          readonly matterTitle: string;
          readonly minutes: number;
          readonly value: Money.Money;
        }[],
        NotPermitted | RepositoryFailure,
        CurrentUser
      > =>
        Effect.gen(function* () {
          yield* permitted("time:read");
          const visible = yield* scope;
          if (visible._tag !== "WholeFirm") return [];

          const [unbilled, everyMatter] = yield* Effect.all(
            [entries.unbilled(), cases.all()],
            { concurrency: "unbounded" },
          );

          const matters = new Map(
            everyMatter.map((matter) => [matter.id, matter] as const),
          );

          const byMatter = new Map<CaseId, readonly Time.TimeEntry[]>();
          for (const entry of unbilled) {
            byMatter.set(entry.caseId, [
              ...(byMatter.get(entry.caseId) ?? []),
              entry,
            ]);
          }

          return [...byMatter.entries()]
            .map(([caseId, forMatter]) => {
              const matter = matters.get(caseId);
              return {
                caseId,
                matterNumber: matter?.number ?? "—",
                matterTitle: matter?.title ?? "Unknown matter",
                minutes: Time.totalMinutes(forMatter),
                value: Time.billableValue(forMatter),
              };
            })
            .sort((a, b) => b.value - a.value);
        }),
    };
  }),
}) {}
