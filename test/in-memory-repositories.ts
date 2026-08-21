import { Effect, Layer, Option, Ref, Schema } from "effect";
import type * as Audit from "@/domain/audit/entry";
import * as Billing from "@/domain/billing/invoice";
import * as Money from "@/domain/shared/money";
import * as Ledger from "@/domain/trust/ledger";
import * as Time from "@/domain/time/entry";
import type * as Hearing from "@/domain/court/hearing";
import type * as Work from "@/domain/work/task";
import type * as Diary from "@/domain/diary/appointment";
import * as Correspondence from "@/domain/message/message";
import type * as Log from "@/domain/firm/contact";
import type * as Library from "@/domain/firm/precedent";
import { ReportRepository } from "@/services/reports";
import { SearchRepository } from "@/services/search";
import type * as Documents from "@/domain/document/document";
import type * as Matter from "@/domain/case/case";
import type * as Client from "@/domain/client/client";
import type * as Firm from "@/domain/firm/advocate";
import type * as Identity from "@/domain/identity/principal";
import {
  type CaseId,
  type ClientId,
  type InvoiceId,
  UserId,
} from "@/domain/shared/ids";
import {
  AdvocateRepository,
  AppointmentRepository,
  AuditRepository,
  CaseNumberTaken,
  CaseRepository,
  ClientRepository,
  DocumentRepository,
  DocumentStore,
  HearingRepository,
  InvoiceNumberTaken,
  InvoiceRepository,
  NotFound,
  RepositoryFailure,
  StorageFailure,
  AttemptLimiter,
  SessionGateway,
  ContactRepository,
  MessageRepository,
  PrecedentRepository,
  TaskRepository,
  TimeRepository,
  Transactor,
  TrustRepository,
  VersionAlreadyExists,
  UserRepository,
} from "@/services/repositories";

/**
 * The repositories, backed by arrays.
 *
 * This file is the payoff for declaring repository interfaces in `services/`
 * instead of reaching for Postgres directly. `CaseService` asks for
 * `CaseRepository`; these Layers are one way to supply it and `PgLive` is
 * another, and the service cannot tell which it got. No mocking framework, no
 * stubbed method names to keep in sync — a second implementation of an
 * interface that already existed.
 *
 * They are not permissive. **A fake that accepts writes the real one refuses is
 * a fake that makes tests pass and production fail**, so the uniqueness of
 * `cases.number` is enforced here exactly as the unique index enforces it — and
 * that is what lets `CaseService.open`'s retry be tested at all.
 */

const notFound = (entity: string, id: string) =>
  Effect.fail(new NotFound({ entity, id }));

/** Replaces the entry with this id, or appends it. */
const upsert = <A extends { readonly id: string }>(
  rows: readonly A[],
  row: A,
): readonly A[] => {
  const at = rows.findIndex((existing) => existing.id === row.id);
  return at === -1 ? [...rows, row] : rows.toSpliced(at, 1, row);
};

/**
 * The matters, with the array they live in exposed.
 *
 * `inMemoryCases` is this with the store hidden, which is what almost every
 * test wants. The exception is the transaction test: proving that a failed
 * audit write takes the matter with it means being able to hand the same `Ref`
 * to `inMemoryTransactor`, and a store nobody can reach is a store nobody can
 * roll back.
 */
export const casesWithStore = (
  seed: readonly Matter.Case[] = [],
): {
  readonly layer: Layer.Layer<CaseRepository>;
  readonly store: Ref.Ref<readonly Matter.Case[]>;
} => {
  const store = Ref.unsafeMake(seed);
  return { store, layer: casesOver(store) };
};

export const inMemoryCases = (
  seed: readonly Matter.Case[] = [],
): Layer.Layer<CaseRepository> => casesWithStore(seed).layer;

const casesOver = (
  store: Ref.Ref<readonly Matter.Case[]>,
): Layer.Layer<CaseRepository> =>
  Layer.sync(CaseRepository, () => {
    const find = (id: CaseId) =>
      Ref.get(store).pipe(
        Effect.map((rows) =>
          Option.fromNullable(rows.find((matter) => matter.id === id)),
        ),
      );

    return CaseRepository.of({
      findById: find,

      byId: (id) =>
        find(id).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => notFound("Case", id),
              onSome: Effect.succeed<Matter.Case>,
            }),
          ),
        ),

      forClient: (clientId) =>
        Ref.get(store).pipe(
          Effect.map((rows) =>
            rows.filter((matter) => matter.clientId === clientId),
          ),
        ),

      openMatters: () =>
        Ref.get(store).pipe(
          Effect.map((rows) =>
            rows.filter((matter) => matter.status !== "Closed"),
          ),
        ),

      all: () => Ref.get(store),

      save: (matter) =>
        Effect.gen(function* () {
          const rows = yield* Ref.get(store);

          // The `cases_number_key` unique index, in one line.
          const clash = rows.some(
            (existing) =>
              existing.number === matter.number && existing.id !== matter.id,
          );
          if (clash) {
            return yield* Effect.fail(
              new CaseNumberTaken({ number: matter.number }),
            );
          }

          yield* Ref.set(store, upsert(rows, matter));
          return matter;
        }),
    });
  });

export const inMemoryClients = (
  seed: readonly Client.Client[] = [],
): Layer.Layer<ClientRepository> =>
  Layer.effect(
    ClientRepository,
    Effect.gen(function* () {
      const store = yield* Ref.make(seed);

      return ClientRepository.of({
        byId: (id: ClientId) =>
          Ref.get(store).pipe(
            Effect.flatMap((rows) => {
              const found = rows.find((client) => client.id === id);
              return found === undefined
                ? notFound("Client", id)
                : Effect.succeed(found);
            }),
          ),

        all: () => Ref.get(store),

        save: (client) =>
          Ref.update(store, (rows) => upsert(rows, client)).pipe(
            Effect.as(client),
          ),
      });
    }),
  );

export const inMemoryAdvocates = (
  seed: readonly Firm.Advocate[] = [],
): Layer.Layer<AdvocateRepository> =>
  Layer.effect(
    AdvocateRepository,
    Effect.gen(function* () {
      const store = yield* Ref.make(seed);

      return AdvocateRepository.of({
        byId: (id) =>
          Ref.get(store).pipe(
            Effect.flatMap((rows) => {
              const found = rows.find((advocate) => advocate.id === id);
              return found === undefined
                ? notFound("Advocate", id)
                : Effect.succeed(found);
            }),
          ),

        all: () => Ref.get(store),

        save: (advocate) =>
          Ref.update(store, (rows) => upsert(rows, advocate)).pipe(
            Effect.as(advocate),
          ),
      });
    }),
  );

/**
 * Invoices and the trust ledger, over stores they share.
 *
 * They are built together because one operation spans both. `settleFromTrust`
 * writes a payment and a trust movement that are only meaningful as a pair, and
 * a fake in which the invoice store and the ledger store are strangers cannot
 * represent that at all.
 *
 * What this fake does and does not promise is worth stating, because the
 * temptation is to claim more:
 *
 * - **It enforces Rule 10.** `Ledger.recordWithdrawal` is the domain's own
 *   check and it is what runs here, so a settlement against a client without
 *   the balance is refused with the same `TrustAccountUnderfunded` the trigger
 *   produces. A fake that accepted it would make `BillingService.settle`'s
 *   tests pass and production fail, which is the failure mode this whole file
 *   exists to avoid.
 * - **It does not promise atomicity.** Two `Ref` updates are not a transaction,
 *   and the property that a refused withdrawal leaves no payment row behind is
 *   Postgres's to keep. That is tested against real Postgres in
 *   `invoice-repository.integration.test.ts`, where it means something.
 *
 * The division is the same one the whole test strategy rests on: rules here,
 * storage guarantees there.
 */
export interface BillingStores {
  readonly invoices: Layer.Layer<InvoiceRepository>;
  readonly trust: Layer.Layer<TrustRepository>;
  readonly both: Layer.Layer<InvoiceRepository | TrustRepository>;
  readonly invoiceStore: Ref.Ref<readonly Billing.Invoice[]>;
  readonly movementStore: Ref.Ref<readonly Ledger.TrustMovement[]>;
}

export const inMemoryBilling = (
  seed: {
    readonly invoices?: readonly Billing.Invoice[];
    readonly movements?: readonly Ledger.TrustMovement[];
  } = {},
): BillingStores => {
  const invoiceStore = Ref.unsafeMake(seed.invoices ?? []);
  const movementStore = Ref.unsafeMake(seed.movements ?? []);

  const invoices = Layer.sync(InvoiceRepository, () =>
    InvoiceRepository.of({
      byId: (id: InvoiceId) =>
        Ref.get(invoiceStore).pipe(
          Effect.flatMap((rows) => {
            const found = rows.find((invoice) => invoice.id === id);
            return found === undefined
              ? notFound("Invoice", id)
              : Effect.succeed(found);
          }),
        ),

      forClient: (clientId) =>
        Ref.get(invoiceStore).pipe(
          Effect.map((rows) =>
            rows.filter((invoice) => invoice.clientId === clientId),
          ),
        ),

      all: () => Ref.get(invoiceStore),

      save: (invoice) =>
        Effect.gen(function* () {
          const rows = yield* Ref.get(invoiceStore);

          // The `invoices_number_key` unique index, in one line — the same
          // reason `casesOver` enforces `cases_number_key`: the retry in
          // `BillingService.raise` is only testable against a fake that can
          // actually refuse.
          const clash = rows.some(
            (existing) =>
              existing.number === invoice.number && existing.id !== invoice.id,
          );
          if (clash) {
            return yield* Effect.fail(
              new InvoiceNumberTaken({ number: invoice.number }),
            );
          }

          yield* Ref.set(invoiceStore, upsert(rows, invoice));
          return invoice;
        }),

      /**
       * An append, and the M-Pesa index it can be refused by.
       *
       * The uniqueness enforced here is the *partial* one: across every
       * invoice, and only for M-Pesa. A fake that checked the whole reference
       * column would refuse two cheques carrying the same client reference,
       * which Postgres accepts — and a fake that is stricter than the real
       * thing fails tests for behaviour that works in production, which teaches
       * everyone to distrust it.
       */
      recordPayment: (invoiceId, payment) =>
        Effect.gen(function* () {
          const rows = yield* Ref.get(invoiceStore);
          const at = rows.findIndex((invoice) => invoice.id === invoiceId);
          const invoice = rows[at];

          if (invoice === undefined) {
            return yield* notFound("Invoice", invoiceId);
          }

          const confirmation = Billing.confirmationOf(payment);
          if (confirmation !== undefined) {
            const banked = rows.some((each) =>
              each.payments.some(
                (existing) => Billing.confirmationOf(existing) === confirmation,
              ),
            );
            if (banked) {
              return yield* Effect.fail(
                new Billing.PaymentAlreadyRecorded({ confirmation }),
              );
            }
          }

          yield* Ref.set(
            invoiceStore,
            rows.toSpliced(at, 1, {
              ...invoice,
              payments: [...invoice.payments, payment],
            }),
          );
        }),

      settleFromTrust: ({ invoiceId, payment, movement }) =>
        Effect.gen(function* () {
          const rows = yield* Ref.get(invoiceStore);
          const at = rows.findIndex((invoice) => invoice.id === invoiceId);
          const invoice = rows[at];

          if (invoice === undefined) {
            return yield* notFound("Invoice", invoiceId);
          }

          /**
           * Rule 10, from the domain rather than restated.
           *
           * The withdrawal is attempted *first*, mirroring the ordering the
           * real implementation is careful about in the other direction: there
           * the movement is written last so the rollback path is exercised;
           * here there is no rollback, so the write that can be refused has to
           * happen before the one that cannot.
           */
          const movements = yield* Ref.get(movementStore);
          const ledger = yield* Effect.mapError(
            Ledger.recordWithdrawal(movements, {
              id: movement.id,
              clientId: movement.clientId,
              reason: movement.reason,
              amount: Money.fromCents(movement.amount),
              recordedAt: movement.recordedAt,
              reference: movement.reference,
            }),
            (error) =>
              error._tag === "TrustAccountUnderfunded"
                ? error
                : new RepositoryFailure({
                    operation: "settleFromTrust",
                    detail: error._tag,
                  }),
          );

          yield* Ref.set(movementStore, ledger);
          yield* Ref.set(
            invoiceStore,
            rows.toSpliced(at, 1, {
              ...invoice,
              payments: [...invoice.payments, payment],
            }),
          );
        }),
    }),
  );

  const trust = Layer.sync(TrustRepository, () =>
    TrustRepository.of({
      balanceFor: (clientId) =>
        Ref.get(movementStore).pipe(
          Effect.map((rows) => Ledger.balanceFor(rows, clientId)),
        ),

      movementsFor: (clientId) =>
        Ref.get(movementStore).pipe(
          Effect.map((rows) =>
            rows.filter((movement) => movement.clientId === clientId),
          ),
        ),

      recordDeposit: (movement) =>
        Ref.update(movementStore, (rows) => [...rows, movement]).pipe(
          Effect.as(movement),
        ),

      recordWithdrawal: (movement) =>
        Effect.gen(function* () {
          const rows = yield* Ref.get(movementStore);

          const ledger = yield* Effect.mapError(
            Ledger.recordWithdrawal(rows, {
              id: movement.id,
              clientId: movement.clientId,
              reason: movement.reason,
              amount: Money.fromCents(movement.amount),
              recordedAt: movement.recordedAt,
              reference: movement.reference,
            }),
            (error) =>
              error._tag === "TrustAccountUnderfunded"
                ? error
                : new RepositoryFailure({
                    operation: "recordWithdrawal",
                    detail: error._tag,
                  }),
          );

          yield* Ref.set(movementStore, ledger);
          return movement;
        }),

      overdrawn: () =>
        Ref.get(movementStore).pipe(
          Effect.map((rows) => Ledger.overdrawnClients(rows)),
        ),
    }),
  );

  return {
    invoices,
    trust,
    both: Layer.merge(invoices, trust),
    invoiceStore,
    movementStore,
  };
};

/** Just the invoices, for the tests that never touch client money. */
export const inMemoryInvoices = (
  seed: readonly Billing.Invoice[] = [],
): Layer.Layer<InvoiceRepository> =>
  inMemoryBilling({ invoices: seed }).invoices;

/** Just the ledger. */
export const inMemoryTrust = (
  seed: readonly Ledger.TrustMovement[] = [],
): Layer.Layer<TrustRepository> => inMemoryBilling({ movements: seed }).trust;

/**
 * Recorded work, in an array — with the claim that makes billing safe.
 *
 * `carryOnto` is the operation worth faking carefully. The real one is a single
 * `UPDATE … WHERE invoice_id IS NULL` whose *count* tells the caller whether it
 * won the race against somebody else billing the same matter. A fake that
 * marked every requested entry regardless would report six of six every time,
 * and `BillingService.raiseFromTime`'s guard against double-billing would never
 * be exercised — the test would pass and the property would be untested.
 *
 * So this skips entries already carried, exactly as the `WHERE` clause does,
 * and returns how many it actually took.
 */
export interface TimeStore {
  readonly layer: Layer.Layer<TimeRepository>;
  readonly store: Ref.Ref<readonly Time.TimeEntry[]>;
}

export const timeWithStore = (
  seed: readonly Time.TimeEntry[] = [],
): TimeStore => {
  const store = Ref.unsafeMake(seed);

  const layer = Layer.sync(TimeRepository, () =>
    TimeRepository.of({
      byId: (id) =>
        Ref.get(store).pipe(
          Effect.flatMap((rows) => {
            const found = rows.find((entry) => entry.id === id);
            return found === undefined
              ? notFound("TimeEntry", id)
              : Effect.succeed(found);
          }),
        ),

      forCase: (caseId) =>
        Ref.get(store).pipe(
          Effect.map((rows) => rows.filter((entry) => entry.caseId === caseId)),
        ),

      forAdvocate: (advocateId) =>
        Ref.get(store).pipe(
          Effect.map((rows) =>
            rows.filter((entry) => entry.advocateId === advocateId),
          ),
        ),

      unbilled: (caseId) =>
        Ref.get(store).pipe(
          Effect.map((rows) =>
            rows.filter(
              (entry) =>
                entry.billable &&
                Option.isNone(entry.invoicedOn) &&
                (caseId === undefined || entry.caseId === caseId),
            ),
          ),
        ),

      recent: (limit) =>
        Ref.get(store).pipe(Effect.map((rows) => rows.slice(0, limit))),

      save: (entry) =>
        Ref.update(store, (rows) => upsert(rows, entry)).pipe(Effect.as(entry)),

      carryOnto: (invoiceId, ids) =>
        Effect.gen(function* () {
          const rows = yield* Ref.get(store);
          const wanted = new Set<string>(ids);

          // The `WHERE invoice_id IS NULL AND billable` clause, in one line:
          // an entry somebody else already claimed is passed over rather than
          // overwritten, and the count is what the caller checks.
          const claimable = rows.filter(
            (entry) =>
              wanted.has(entry.id) &&
              entry.billable &&
              Option.isNone(entry.invoicedOn),
          );

          yield* Ref.set(
            store,
            rows.map((entry) =>
              claimable.includes(entry)
                ? { ...entry, invoicedOn: Option.some(invoiceId) }
                : entry,
            ),
          );

          return claimable.length;
        }),
    }),
  );

  return { layer, store };
};

export const inMemoryTime = (
  seed: readonly Time.TimeEntry[] = [],
): Layer.Layer<TimeRepository> => timeWithStore(seed).layer;

/**
 * Court dates, in an array.
 *
 * `pending` mirrors the `hearings_upcoming` partial index — no outcome, in date
 * order — rather than returning everything and letting the caller filter. A
 * fake that answered a different question from the real one is a fake that
 * makes a test pass for the wrong reason.
 */
export const hearingsWithStore = (
  seed: readonly Hearing.Hearing[] = [],
): {
  readonly layer: Layer.Layer<HearingRepository>;
  readonly store: Ref.Ref<readonly Hearing.Hearing[]>;
} => {
  const store = Ref.unsafeMake(seed);

  const layer = Layer.sync(HearingRepository, () =>
    HearingRepository.of({
      byId: (id) =>
        Ref.get(store).pipe(
          Effect.flatMap((rows) => {
            const found = rows.find((hearing) => hearing.id === id);
            return found === undefined
              ? notFound("Hearing", id)
              : Effect.succeed(found);
          }),
        ),

      forCase: (caseId) =>
        Ref.get(store).pipe(
          Effect.map((rows) =>
            rows
              .filter((hearing) => hearing.caseId === caseId)
              .sort(
                (a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime(),
              ),
          ),
        ),

      pending: () =>
        Ref.get(store).pipe(
          Effect.map((rows) =>
            rows
              .filter((hearing) => hearing.outcome === undefined)
              .sort(
                (a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime(),
              ),
          ),
        ),

      all: () => Ref.get(store),

      save: (hearing) =>
        Ref.update(store, (rows) => upsert(rows, hearing)).pipe(
          Effect.as(hearing),
        ),
    }),
  );

  return { layer, store };
};

export const inMemoryHearings = (
  seed: readonly Hearing.Hearing[] = [],
): Layer.Layer<HearingRepository> => hearingsWithStore(seed).layer;

/**
 * The work list.
 *
 * `open` sorts by due date and `openCount` counts, both matching what the
 * partial index and the `count(*)` do in Postgres. `openCount` is not
 * `open().length` filtered by matter, deliberately: the whole reason the real
 * one is a `count(*)` is that `CaseService` wants a number and not forty rows,
 * and a fake that quietly read them all would hide the difference.
 */
export const tasksWithStore = (
  seed: readonly Work.Task[] = [],
): {
  readonly layer: Layer.Layer<TaskRepository>;
  readonly store: Ref.Ref<readonly Work.Task[]>;
} => {
  const store = Ref.unsafeMake(seed);

  const layer = Layer.sync(TaskRepository, () =>
    TaskRepository.of({
      byId: (id) =>
        Ref.get(store).pipe(
          Effect.flatMap((rows) => {
            const found = rows.find((task) => task.id === id);
            return found === undefined
              ? notFound("Task", id)
              : Effect.succeed(found);
          }),
        ),

      forCase: (caseId) =>
        Ref.get(store).pipe(
          Effect.map((rows) =>
            rows
              .filter(
                (task) =>
                  Option.isSome(task.caseId) && task.caseId.value === caseId,
              )
              .sort((a, b) => a.dueOn.getTime() - b.dueOn.getTime()),
          ),
        ),

      open: () =>
        Ref.get(store).pipe(
          Effect.map((rows) =>
            rows
              .filter((task) => task.status !== "Done")
              .sort((a, b) => a.dueOn.getTime() - b.dueOn.getTime()),
          ),
        ),

      openCount: (caseId) =>
        Ref.get(store).pipe(
          Effect.map(
            (rows) =>
              rows.filter(
                (task) =>
                  task.status !== "Done" &&
                  Option.isSome(task.caseId) &&
                  task.caseId.value === caseId,
              ).length,
          ),
        ),

      save: (task) =>
        Ref.update(store, (rows) => upsert(rows, task)).pipe(Effect.as(task)),
    }),
  );

  return { layer, store };
};

export const inMemoryTasks = (
  seed: readonly Work.Task[] = [],
): Layer.Layer<TaskRepository> => tasksWithStore(seed).layer;

/**
 * Correspondence.
 *
 * `markRead` **skips already-read messages**, exactly as the real one does,
 * and that is not a detail: the append-only trigger in Postgres refuses a
 * second, different read time, so a fake that overwrote them would let a
 * caller pass here and fail the whole statement against a real database.
 *
 * `unanswered` reproduces the `DISTINCT ON` query's meaning rather than its
 * shape — the earliest message in the latest unbroken run from each client —
 * by reusing the domain's own `awaitingReply`. That is deliberate: the SQL and
 * the fake should agree because they encode the same rule, not because someone
 * translated one into the other twice.
 */
export const messagesWithStore = (
  seed: readonly Correspondence.Message[] = [],
): {
  readonly layer: Layer.Layer<MessageRepository>;
  readonly store: Ref.Ref<readonly Correspondence.Message[]>;
} => {
  const store = Ref.unsafeMake(seed);

  const layer = Layer.sync(MessageRepository, () =>
    MessageRepository.of({
      forClient: (clientId) =>
        Ref.get(store).pipe(
          Effect.map((rows) =>
            rows
              .filter((message) => message.clientId === clientId)
              .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime()),
          ),
        ),

      unanswered: () =>
        Ref.get(store).pipe(
          Effect.map((rows) => {
            const byClient = new Map<string, Correspondence.Message[]>();
            for (const message of rows) {
              const thread = byClient.get(message.clientId) ?? [];
              thread.push(message);
              byClient.set(message.clientId, thread);
            }

            return [...byClient.values()]
              .flatMap((thread) => {
                const waiting = Correspondence.awaitingReply(thread);
                return Option.isSome(waiting) ? [waiting.value] : [];
              })
              .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
          }),
        ),

      send: (message) =>
        Ref.update(store, (rows) => [...rows, message]).pipe(
          Effect.as(message),
        ),

      markRead: (ids, at) =>
        Ref.modify(store, (rows) => {
          const wanted = new Set<string>(ids);
          let changed = 0;

          const next = rows.map((message) => {
            if (!wanted.has(message.id) || Option.isSome(message.readAt)) {
              return message;
            }
            changed += 1;
            return Correspondence.markRead(message, at);
          });

          return [changed, next];
        }),
    }),
  );

  return { layer, store };
};

export const inMemoryMessages = (
  seed: readonly Correspondence.Message[] = [],
): Layer.Layer<MessageRepository> => messagesWithStore(seed).layer;

/**
 * The contact log and the precedent bank.
 *
 * `latestPerClient` folds to one entry per client, which is what the real
 * `DISTINCT ON` does; writing it as a filter over `recent()` would agree with
 * the query by accident rather than by construction.
 */
export const contactsWithStore = (
  seed: readonly Log.Contact[] = [],
): {
  readonly layer: Layer.Layer<ContactRepository>;
  readonly store: Ref.Ref<readonly Log.Contact[]>;
} => {
  const store = Ref.unsafeMake(seed);

  const newestFirst = (rows: readonly Log.Contact[]) =>
    [...rows].sort((a, b) => b.occurredOn.getTime() - a.occurredOn.getTime());

  const layer = Layer.sync(ContactRepository, () =>
    ContactRepository.of({
      forClient: (clientId) =>
        Ref.get(store).pipe(
          Effect.map((rows) =>
            newestFirst(rows.filter((each) => each.clientId === clientId)),
          ),
        ),

      recent: (limit) =>
        Ref.get(store).pipe(
          Effect.map((rows) => newestFirst(rows).slice(0, limit)),
        ),

      latestPerClient: () =>
        Ref.get(store).pipe(
          Effect.map((rows) => {
            const latest = new Map<string, Log.Contact>();
            for (const contact of newestFirst(rows)) {
              if (!latest.has(contact.clientId)) {
                latest.set(contact.clientId, contact);
              }
            }
            return [...latest.values()];
          }),
        ),

      log: (contact) =>
        Ref.update(store, (rows) => [...rows, contact]).pipe(
          Effect.as(contact),
        ),
    }),
  );

  return { layer, store };
};

export const inMemoryContacts = (
  seed: readonly Log.Contact[] = [],
): Layer.Layer<ContactRepository> => contactsWithStore(seed).layer;

/**
 * The reporting aggregates, computed in TypeScript from the same fixtures.
 *
 * **Deliberately written from the domain's own functions** — `Billing.total`,
 * `Billing.outstanding`, `Time.value` — rather than reimplementing the SQL.
 * That is the point of this fake: the service tests then check that the
 * *service* assembles a report correctly, and the separate integration test
 * checks that the SQL agrees with these same domain functions against real
 * Postgres. Reimplementing the queries here would mean two hand-written
 * aggregates agreeing with each other and neither with the domain.
 */
export const inMemoryReports = (firm: {
  readonly invoices: readonly Billing.Invoice[];
  readonly time: readonly Time.TimeEntry[];
  readonly matters: readonly Matter.Case[];
}): Layer.Layer<ReportRepository> =>
  Layer.succeed(
    ReportRepository,
    ReportRepository.of({
      ageing: (asAt: Date) => {
        const bands = [
          { label: "Not yet due", from: 0, within: (d: number) => d <= 0 },
          {
            label: "1-30 days",
            from: 1,
            within: (d: number) => d >= 1 && d <= 30,
          },
          {
            label: "31-60 days",
            from: 31,
            within: (d: number) => d >= 31 && d <= 60,
          },
          {
            label: "61-90 days",
            from: 61,
            within: (d: number) => d >= 61 && d <= 90,
          },
          { label: "Over 90 days", from: 91, within: (d: number) => d > 90 },
        ];

        const owing = firm.invoices
          .map((invoice) => ({
            outstanding: Billing.outstanding(invoice),
            days: Math.floor(
              (asAt.getTime() - invoice.dueOn.getTime()) /
                (24 * 60 * 60 * 1000),
            ),
          }))
          .filter((each) => each.outstanding > 0);

        return Effect.succeed(
          bands.map(({ label, from, within }) => {
            const inBand = owing.filter((each) => within(each.days));
            return {
              label,
              from,
              outstanding: Money.sum(inBand.map((each) => each.outstanding)),
              count: inBand.length,
            };
          }),
        );
      },

      monthly: (months, asAt) => {
        const key = (date: Date) =>
          `${String(date.getUTCFullYear())}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;

        const span = Array.from({ length: months }, (_, index) => {
          const at = new Date(
            Date.UTC(
              asAt.getUTCFullYear(),
              asAt.getUTCMonth() - (months - 1 - index),
              1,
            ),
          );
          return key(at);
        });

        return Effect.succeed(
          span.map((month) => ({
            month,
            billed: Money.sum(
              firm.invoices
                .filter((invoice) => key(invoice.issuedOn) === month)
                .map(Billing.total),
            ),
            collected: Money.sum(
              firm.invoices.flatMap((invoice) =>
                invoice.payments
                  .filter((payment) => key(payment.receivedOn) === month)
                  .map((payment) => Money.fromCents(payment.amountCents)),
              ),
            ),
          })),
        );
      },

      productivity: () => {
        const byEarner = new Map<string, Time.TimeEntry[]>();
        for (const entry of firm.time) {
          byEarner.set(entry.advocateId, [
            ...(byEarner.get(entry.advocateId) ?? []),
            entry,
          ]);
        }

        return Effect.succeed(
          [...byEarner.entries()].map(([advocateId, entries]) => {
            const billable = entries.filter((entry) => entry.billable);
            const invoiced = billable.filter((entry) =>
              Option.isSome(entry.invoicedOn),
            );

            return {
              advocateId: advocateId as Time.TimeEntry["advocateId"],
              minutes: entries.reduce((sum, each) => sum + each.minutes, 0),
              billableMinutes: billable.reduce(
                (sum, each) => sum + each.minutes,
                0,
              ),
              recorded: Money.sum(billable.map(Time.value)),
              billed: Money.sum(invoiced.map(Time.value)),
            };
          }),
        );
      },

      debtors: () => {
        const byClient = new Map<string, Billing.Invoice[]>();
        for (const invoice of firm.invoices) {
          if (Billing.outstanding(invoice) <= 0) continue;
          byClient.set(invoice.clientId, [
            ...(byClient.get(invoice.clientId) ?? []),
            invoice,
          ]);
        }

        return Effect.succeed(
          [...byClient.entries()]
            .map(([clientId, owing]) => ({
              clientId: clientId as Billing.Invoice["clientId"],
              outstanding: Money.sum(owing.map(Billing.outstanding)),
              oldestDueOn: owing
                .map((invoice) => invoice.dueOn)
                .reduce((a, b) => (a.getTime() < b.getTime() ? a : b)),
              invoices: owing.length,
            }))
            .sort((a, b) => b.outstanding - a.outstanding),
        );
      },

      mattersByStatus: () =>
        Effect.succeed(
          tally(firm.matters.map((matter) => matter.status)).map(
            ([status, count]) => ({ status, count }),
          ),
        ),

      mattersByType: () =>
        Effect.succeed(
          tally(firm.matters.map((matter) => matter.type)).map(
            ([type, count]) => ({ type, count }),
          ),
        ),
    }),
  );

/** Counts of each distinct value, commonest first. */
const tally = (values: readonly string[]): readonly [string, number][] => {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
};

/**
 * Search, over arrays.
 *
 * **The scope is applied here too, and that is the point of the fake.** A stub
 * that returned everything regardless of `visibleTo` would let a service test
 * assert "a portal user finds only their own matters" and pass for the wrong
 * reason — the assertion would be checking the fake rather than the code. So
 * the filtering is reproduced, and the tests that matter would fail if
 * `SearchService` stopped passing the scope down.
 */
export const inMemorySearch = (firm: {
  readonly matters: readonly Matter.Case[];
  readonly clients: readonly Client.Client[];
  readonly documents: readonly Documents.Document[];
  readonly invoices: readonly Billing.Invoice[];
}): Layer.Layer<SearchRepository> => {
  const has = (haystack: string | undefined, term: string) =>
    (haystack ?? "").toLowerCase().includes(term.toLowerCase());

  const clientOf = (caseId: string) =>
    firm.matters.find((matter) => matter.id === caseId)?.clientId;

  return Layer.succeed(
    SearchRepository,
    SearchRepository.of({
      matters: (term, visibleTo, limit) =>
        Effect.succeed(
          firm.matters
            .filter(
              (matter) =>
                (visibleTo === undefined || matter.clientId === visibleTo) &&
                (has(matter.number, term) ||
                  has(matter.title, term) ||
                  has(matter.causeNumber, term) ||
                  matter.opposingParties.some((party) => has(party, term))),
            )
            .slice(0, limit)
            .map((matter) => ({
              kind: "Matter" as const,
              href: `/cases/${matter.id}`,
              reference: matter.number,
              title: matter.title,
              detail: "",
              rank: matter.number.toLowerCase() === term.toLowerCase() ? 3 : 1,
            })),
        ),

      clients: (term, visibleTo, limit) =>
        Effect.succeed(
          firm.clients
            .filter(
              (client) =>
                (visibleTo === undefined || client.id === visibleTo) &&
                (has(client.name, term) || has(client.number, term)),
            )
            .slice(0, limit)
            .map((client) => ({
              kind: "Client" as const,
              href: `/clients/${client.id}`,
              reference: client.number,
              title: client.name,
              detail: "",
              rank: 1,
            })),
        ),

      documents: (term, visibleTo, limit) =>
        Effect.succeed(
          firm.documents
            .filter(
              (document) =>
                (visibleTo === undefined ||
                  clientOf(document.caseId) === visibleTo) &&
                has(document.name, term),
            )
            .slice(0, limit)
            .map((document) => ({
              kind: "Document" as const,
              href: `/documents/${document.id}`,
              reference: "",
              title: document.name,
              detail: "",
              rank: 1,
            })),
        ),

      invoices: (term, visibleTo, limit) =>
        Effect.succeed(
          firm.invoices
            .filter(
              (invoice) =>
                (visibleTo === undefined || invoice.clientId === visibleTo) &&
                has(invoice.number, term),
            )
            .slice(0, limit)
            .map((invoice) => ({
              kind: "Invoice" as const,
              href: `/billing/invoices/${invoice.id}`,
              reference: invoice.number,
              title: "",
              detail: "",
              rank: 2,
            })),
        ),
    }),
  );
};

export const inMemoryPrecedents = (
  seed: readonly Library.Precedent[] = [],
): Layer.Layer<PrecedentRepository> => {
  const store = Ref.unsafeMake(seed);

  return Layer.sync(PrecedentRepository, () =>
    PrecedentRepository.of({
      all: () =>
        Ref.get(store).pipe(
          Effect.map((rows) =>
            [...rows].sort((a, b) => a.title.localeCompare(b.title)),
          ),
        ),

      save: (precedent) =>
        Ref.update(store, (rows) => upsert(rows, precedent)).pipe(
          Effect.as(precedent),
        ),
    }),
  );
};

/**
 * Documents and their bytes, over stores they share.
 *
 * The store is a `Map` of keys to lengths — it never holds the bytes, because
 * nothing above it reads them. That is not a shortcut: `DocumentStore` has no
 * "get the body" operation at all, since the application hands out a signed URL
 * and the browser fetches the CDN directly. A fake that stored bodies would be
 * modelling an operation the interface does not have.
 *
 * `addVersion` enforces `(document_id, number)` as the real primary key does,
 * so `DocumentService.revise`'s retry is exercised rather than assumed.
 */
export interface DocumentStores {
  readonly documents: Layer.Layer<DocumentRepository>;
  readonly store: Layer.Layer<DocumentStore>;
  readonly both: Layer.Layer<DocumentRepository | DocumentStore>;
  readonly documentStore: Ref.Ref<readonly Documents.Document[]>;
  /** Keys written, and how many bytes each. */
  readonly stored: Ref.Ref<ReadonlyMap<string, number>>;
}

export const inMemoryDocuments = (
  seed: readonly Documents.Document[] = [],
): DocumentStores => {
  const documentStore = Ref.unsafeMake(seed);

  /**
   * The keys the store holds, seeded from the documents it was given.
   *
   * A seeded document whose versions point at nothing would put this fake in a
   * state the real system refuses to reach: `upload` writes the bytes before
   * the row precisely so that a row always has an object behind it, and the
   * seed script uploads a body for every version for the same reason. A fake
   * that started with rows and no objects would make `download` fail for every
   * fixture — which is a bug in the fixture, not a property worth testing.
   *
   * The refusal in `signedUrl` still bites where it should: on a key some
   * *code path* failed to write.
   */
  const stored = Ref.unsafeMake<ReadonlyMap<string, number>>(
    new Map(
      seed.flatMap((document) =>
        document.versions.map(
          (version) => [version.storageKey, version.sizeBytes] as const,
        ),
      ),
    ),
  );

  const documents = Layer.sync(DocumentRepository, () =>
    DocumentRepository.of({
      byId: (id) =>
        Ref.get(documentStore).pipe(
          Effect.flatMap((rows) => {
            const found = rows.find((document) => document.id === id);
            return found === undefined
              ? notFound("Document", id)
              : Effect.succeed(found);
          }),
        ),

      forCase: (caseId) =>
        Ref.get(documentStore).pipe(
          Effect.map((rows) =>
            rows.filter((document) => document.caseId === caseId),
          ),
        ),

      all: () => Ref.get(documentStore),

      save: (document) =>
        Ref.update(documentStore, (rows) => upsert(rows, document)).pipe(
          Effect.as(document),
        ),

      addVersion: (id, version) =>
        Effect.gen(function* () {
          const rows = yield* Ref.get(documentStore);
          const at = rows.findIndex((document) => document.id === id);
          const document = rows[at];

          if (document === undefined) return yield* notFound("Document", id);

          // The `(document_id, number)` primary key, in one line. Without it
          // `revise`'s retry would never be exercised.
          if (
            document.versions.some((each) => each.number === version.number)
          ) {
            return yield* Effect.fail(
              new VersionAlreadyExists({ number: version.number }),
            );
          }

          yield* Ref.set(
            documentStore,
            rows.toSpliced(at, 1, {
              ...document,
              versions: [...document.versions, version],
            }),
          );
        }),
    }),
  );

  const store = Layer.sync(DocumentStore, () =>
    DocumentStore.of({
      /**
       * Refuses to overwrite, exactly as the real store does.
       *
       * A fake that quietly replaced the bytes at an existing key would let a
       * caller pass here and fail against Vercel Blob — which is precisely
       * what happened to the seed script, whose comment claimed a second run
       * "overwrites the same objects". It does not; the store answers "this
       * blob already exists", and that refusal is the store's half of
       * "versions are append-only".
       */
      put: (key, body) =>
        Ref.get(stored).pipe(
          Effect.flatMap((keys) =>
            keys.has(key)
              ? Effect.fail(
                  new StorageFailure({
                    operation: "put",
                    detail: `an object already exists at ${key}`,
                  }),
                )
              : Ref.update(stored, (keys) =>
                  new Map(keys).set(key, body.byteLength),
                ).pipe(Effect.as({ sizeBytes: body.byteLength })),
          ),
        ),

      /**
       * A URL shaped like the real one, and refusing a key that was never
       * written.
       *
       * The refusal matters: a fake that signed any string would let a test
       * pass while the service handed out a URL for an object that does not
       * exist — which is exactly the "row with no object" failure the upload
       * ordering is arranged to avoid.
       */
      signedUrl: (key) =>
        Ref.get(stored).pipe(
          Effect.flatMap((keys) =>
            keys.has(key)
              ? Effect.succeed(
                  `https://blob.test/${key}?signature=fake&expires=900`,
                )
              : Effect.fail(
                  new StorageFailure({
                    operation: "signedUrl",
                    detail: `no object at ${key}`,
                  }),
                ),
          ),
        ),

      remove: (key) =>
        Ref.update(stored, (keys) => {
          const next = new Map(keys);
          next.delete(key);
          return next;
        }),
    }),
  );

  return {
    documents,
    store,
    both: Layer.merge(documents, store),
    documentStore,
    stored,
  };
};

/**
 * The audit trail, in an array — plus a way to read it back in a test.
 *
 * `recorded` is returned alongside the Layer rather than being reachable
 * through the interface, because `AuditRepository` has no "give me everything"
 * operation and should not grow one to satisfy a test. What a test wants to
 * assert is that the entry was written; what the application needs is
 * `recent(n)`, and those are not the same question.
 */
export const inMemoryAudit = (): {
  readonly layer: Layer.Layer<AuditRepository>;
  readonly recorded: Effect.Effect<readonly Audit.AuditEntry[]>;
} => {
  const store = Ref.unsafeMake<readonly Audit.AuditEntry[]>([]);

  return {
    recorded: Ref.get(store),
    layer: Layer.succeed(
      AuditRepository,
      AuditRepository.of({
        record: (entry) =>
          Ref.update(store, (rows) => [entry, ...rows]).pipe(Effect.as(entry)),

        recent: (limit) =>
          Ref.get(store).pipe(Effect.map((rows) => rows.slice(0, limit))),

        forEntity: (entity, id) =>
          Ref.get(store).pipe(
            Effect.map((rows) =>
              rows.filter(
                (entry) =>
                  entry.entity === entity &&
                  Option.getOrNull(entry.entityId) === id,
              ),
            ),
          ),
      }),
    ),
  };
};

/**
 * A transaction that actually rolls back.
 *
 * The lazy version of this fake — `transaction: (effect) => effect` — would
 * make every test pass and prove nothing, because the property under test is
 * that a failed audit write takes the matter with it. So the two stores that
 * participate are snapshotted before the body runs and restored if it fails,
 * which is what Postgres does and is the whole reason the interface exists.
 *
 * It is not a general transaction: it knows which `Ref`s to restore because the
 * test wires them. A fake that pretended to be more than that would be claiming
 * a guarantee it cannot keep.
 */
export interface Restorable {
  /** Reads the current value, and yields the effect that puts it back. */
  readonly snapshot: Effect.Effect<Effect.Effect<void>>;
}

/**
 * A store the transactor can roll back.
 *
 * The indirection exists to keep the element type out of the signature: `Ref`
 * is invariant, so a list of stores holding different types cannot be typed as
 * `Ref<unknown>[]` without a cast, and a cast in a test helper is the kind of
 * thing that quietly stops restoring anything.
 */
export const restorable = <A>(ref: Ref.Ref<A>): Restorable => ({
  snapshot: Effect.map(Ref.get(ref), (value) => Ref.set(ref, value)),
});

export const inMemoryTransactor = (
  ...stores: readonly Restorable[]
): Layer.Layer<Transactor> =>
  Layer.succeed(
    Transactor,
    Transactor.of({
      transaction: (effect) =>
        Effect.gen(function* () {
          const undo = yield* Effect.forEach(stores, (store) => store.snapshot);

          return yield* effect.pipe(
            Effect.tapError(() => Effect.all(undo, { discard: true })),
          );
        }),
    }),
  );

/**
 * Logins, in an array.
 *
 * Keyed by the principal's own `userId`, so a test writes `inMemoryUsers([
 * asWanjiku, asPartner ])` and the lookup the middleware performs on every
 * request finds them.
 */
export const inMemoryUsers = (
  seed: readonly Identity.Principal[] = [],
): Layer.Layer<UserRepository> =>
  Layer.sync(UserRepository, () => {
    const store = Ref.unsafeMake(seed);

    const find = (match: (principal: Identity.Principal) => boolean) =>
      Ref.get(store).pipe(
        Effect.map((rows) => Option.fromNullable(rows.find(match))),
      );

    return UserRepository.of({
      principalOf: (id) =>
        find((principal) => principal.userId === id).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => notFound("User", id),
              onSome: Effect.succeed<Identity.Principal>,
            }),
          ),
        ),

      byEmail: (email) =>
        find(
          (principal) => principal.email.toLowerCase() === email.toLowerCase(),
        ),

      provision: () =>
        Effect.die(
          "provision has no in-memory equivalent: the constraint it exists " +
            "to satisfy is users_exactly_one_subject, which is Postgres's",
        ),
    });
  });

/**
 * Sessions, without Better Auth.
 *
 * A token is a cookie value and maps to a user id, which is precisely as much
 * as `SessionGateway` promises — verifying the signature is the library's job
 * and is not what the tests above it are about. What this *does* preserve is
 * the shape of the question: the middleware still parses a `Cookie` header,
 * still gets an `Option`, and still turns "no session" into a 401 rather than
 * into a principal.
 */
export const inMemorySessions = (
  tokens: Readonly<Record<string, string>> = {},
): Layer.Layer<SessionGateway> =>
  Layer.succeed(
    SessionGateway,
    SessionGateway.of({
      identify: (headers) =>
        Effect.gen(function* () {
          const cookie = headers.get("cookie") ?? "";
          const match = /(?:^|;\s*)oklaw\.session_token=([^;]+)/.exec(cookie);
          const token = match?.[1];
          const userId = token === undefined ? undefined : tokens[token];

          return yield* userId === undefined
            ? Effect.succeedNone
            : Effect.map(
                Schema.decodeUnknown(UserId)(userId),
                Option.some<UserId>,
              ).pipe(Effect.orDie);
        }),

      signIn: () => Effect.die("signIn is Better Auth's; see the ADR"),
      signOut: () => Effect.succeed([]),
      handle: () => Effect.die("handle is Better Auth's; see the ADR"),
    }),
  );

/**
 * The appointment diary.
 *
 * `forAdvocateOn` filters by advocate *and* by day, exactly as the real query's
 * two `WHERE` clauses do. A fake that ignored the day would make the clash
 * check look stricter than it is — every appointment an advocate ever had would
 * be a candidate — and the back-to-back test would still pass, which is how a
 * green suite ends up describing behaviour nobody has.
 */
export const appointmentsWithStore = (
  seed: readonly Diary.Appointment[] = [],
): {
  readonly layer: Layer.Layer<AppointmentRepository>;
  readonly store: Ref.Ref<readonly Diary.Appointment[]>;
} => {
  const store = Ref.unsafeMake(seed);

  const layer = Layer.sync(AppointmentRepository, () =>
    AppointmentRepository.of({
      upcoming: () =>
        Ref.get(store).pipe(
          Effect.map((rows) =>
            [...rows].sort(
              (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
            ),
          ),
        ),

      forAdvocateOn: (advocateId, day) =>
        Ref.get(store).pipe(
          Effect.map((rows) =>
            rows
              .filter(
                (appointment) =>
                  appointment.advocateId === advocateId &&
                  appointment.startsAt.toISOString().slice(0, 10) ===
                    day.toISOString().slice(0, 10),
              )
              .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
          ),
        ),

      save: (appointment) =>
        Ref.update(store, (rows) => [...rows, appointment]).pipe(
          Effect.as(appointment),
        ),
    }),
  );

  return { layer, store };
};

export const inMemoryAppointments = (
  seed: readonly Diary.Appointment[] = [],
): Layer.Layer<AppointmentRepository> => appointmentsWithStore(seed).layer;

/**
 * Authentication attempt counters, in a `Ref`.
 *
 * A fixed window is not modelled here and does not need to be: every test that
 * cares about the limit spends within one window, and a fake that also floored
 * timestamps would be a second implementation of the rule the service is being
 * tested against. What this preserves is the shape the service depends on —
 * `spend` returns the count *including* this attempt, and `forget` removes the
 * buckets entirely — because those two are what the sign-in path reasons about.
 */
export const inMemoryLimiter = (): {
  readonly layer: Layer.Layer<AttemptLimiter>;
  readonly store: Ref.Ref<ReadonlyMap<string, number>>;
} => {
  const store = Ref.unsafeMake<ReadonlyMap<string, number>>(new Map());

  return {
    store,
    layer: Layer.succeed(
      AttemptLimiter,
      AttemptLimiter.of({
        spend: (buckets) =>
          Ref.modify(store, (counts) => {
            const next = new Map(counts);
            for (const bucket of buckets) {
              next.set(bucket, (next.get(bucket) ?? 0) + 1);
            }
            const spent = new Map(
              buckets.map((bucket) => [bucket, next.get(bucket) ?? 0]),
            );
            return [spent as ReadonlyMap<string, number>, next];
          }),

        forget: (buckets) =>
          Ref.update(store, (counts) => {
            const next = new Map(counts);
            for (const bucket of buckets) next.delete(bucket);
            return next;
          }),
      }),
    ),
  };
};
