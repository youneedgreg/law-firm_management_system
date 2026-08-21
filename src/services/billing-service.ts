import { DateTime, Effect, Either, Option, Schema } from "effect";
import * as Billing from "../domain/billing/invoice";
import { may, type NotPermitted } from "../domain/identity/permissions";
import * as Money from "../domain/shared/money";
import {
  CaseId,
  ClientId,
  InvoiceId,
  TrustMovementId,
} from "../domain/shared/ids";
import * as Ledger from "../domain/trust/ledger";
import type * as Time from "../domain/time/entry";
import { AuditLog } from "./audit-service";
import { CurrentUser, permitted, scope, withinScope } from "./policy";
import {
  CaseRepository,
  ClientRepository,
  InvoiceRepository,
  type InvoiceNumberTaken,
  type NotFound,
  type RepositoryFailure,
  TimeRepository,
  Transactor,
  TrustRepository,
} from "./repositories";

/**
 * Fee notes and client money.
 *
 * The domain stores neither an invoice's total nor its status — both are
 * functions of the lines, the payments and the date, and Phase 1 refused to
 * persist anything derivable. That decision has a consequence at this boundary:
 * `status` needs to know what day it is, and the domain will not read a clock,
 * so *somebody* has to supply one. This layer is that somebody.
 *
 * Doing it here rather than in the caller is the whole point. An invoice is
 * "Overdue" relative to a moment, and if each screen and each API consumer
 * picked its own moment they would disagree — the list would show Overdue and
 * the detail page Unpaid, for the same row, in the same second. One read of the
 * clock per request, applied to every invoice in it, and they cannot.
 *
 * ## The three ways money moves, and why they are three operations
 *
 * `recordPayment` is the client paying the firm from outside: a cheque, a bank
 * transfer, an M-Pesa confirmation. `deposit` is the client putting money into
 * *client account*, which is not the firm's money and never becomes the firm's
 * money by sitting there. `settle` is the firm taking its fees out of what it
 * already holds — a Rule 9 transfer to office account, and the only operation
 * here that can be refused by Rule 10.
 *
 * Collapsing them into one "record a transaction" would be smaller and would
 * lose the distinction the Advocates (Accounts) Rules are built on: whose money
 * is it right now. That question has exactly one correct answer at every
 * moment, and three separate operations is how the code says so.
 */

// ── What the screens read ─────────────────────────────────────────────────

/** An invoice with the figures a screen would otherwise recompute. */
export interface InvoiceView {
  readonly invoice: Billing.Invoice;
  readonly total: Money.Money;
  readonly paid: Money.Money;
  readonly outstanding: Money.Money;
  readonly status: Billing.InvoiceStatus;
  /** Whole days past due, or 0. */
  readonly daysOverdue: number;
}

/** One client's trust position, derived from their movements. */
export interface TrustAccountView {
  readonly clientId: ClientId;
  readonly clientName: string;
  readonly deposits: Money.Money;
  readonly withdrawals: Money.Money;
  readonly balance: Money.Money;
}

/**
 * The billing screen, assembled once.
 *
 * Two permissions are needed to see all of it and only one to see part, which
 * is why `trust` is optional rather than empty for someone without
 * `trust:read`. An empty list says "the firm holds no client money"; an absent
 * one says "you were not shown this", and those must not look the same on a
 * page about money.
 */
export interface Receivables {
  readonly invoices: readonly InvoiceView[];
  readonly billed: Money.Money;
  readonly collected: Money.Money;
  readonly outstanding: Money.Money;
  readonly overdue: Money.Money;
  readonly trust?: readonly TrustAccountView[] | undefined;
  readonly trustHeld?: Money.Money | undefined;
}

/**
 * The choices a fee-note form has to offer.
 *
 * Its own type rather than a borrowed `IntakeChoices`, and the reason is a
 * permission. `CaseService.intakeChoices` is gated on `case:open`, which a
 * Finance Officer does not hold — and a Finance Officer is precisely the person
 * who raises fee notes. Reaching for the caseload's list here would mean either
 * loosening that gate or leaving the one role that bills the firm's clients
 * unable to name one.
 *
 * The matters are open matters only. A fee note can be raised against a closed
 * matter in principle, and offering forty closed files in a dropdown to make
 * that possible is the wrong trade; `caseId` is optional, so a fee note with no
 * matter is already representable.
 */
export interface BillingChoices {
  readonly clients: readonly { readonly id: ClientId; readonly name: string }[];
  readonly matters: readonly {
    readonly id: CaseId;
    readonly clientId: ClientId;
    readonly number: string;
    readonly title: string;
  }[];
}

/**
 * Everything the fee-note page shows, assembled once.
 *
 * The analogue of `CaseFile`, and it exists for the same reason: a screen shows
 * the client's name and the matter's reference, and resolving them belongs to
 * the layer that can span repositories rather than to the page.
 *
 * `heldOnTrust` is optional and the reason is the same one that makes
 * `Receivables.trust` optional. It answers "can this fee note be settled out of
 * what the firm already holds", which is a question about client money — so a
 * caller without `trust:read` gets no figure rather than a zero. A zero would
 * say the client account is empty.
 */
export interface FeeNote {
  readonly view: InvoiceView;
  readonly clientName: string;
  /** The matter this was raised against, where there is one. */
  readonly matterNumber?: string | undefined;
  readonly heldOnTrust?: Money.Money | undefined;
}

/** A client's ledger: the movements, and what they come to. */
export interface TrustLedgerView {
  readonly clientId: ClientId;
  readonly clientName: string;
  readonly balance: Money.Money;
  readonly movements: readonly Ledger.TrustMovement[];
}

// ── What the boundary accepts ─────────────────────────────────────────────

/**
 * Raising a fee note.
 *
 * `number`, `id` and `payments` are absent for the same reason they are absent
 * from `OpenMatter`: a caller does not choose an identifier, does not choose a
 * fee-note number, and does not raise an invoice that has already been paid.
 * A fee note that arrived with payments on it would be a way to write a payment
 * row without going through `recordPayment` and therefore without an audit
 * entry.
 */
export const RaiseInvoice = Schema.Struct({
  clientId: ClientId,
  caseId: Schema.optional(CaseId),
  issuedOn: Schema.DateFromSelf,
  dueOn: Schema.DateFromSelf,
  lines: Schema.NonEmptyArray(Billing.InvoiceLine),
});

export type RaiseInvoice = typeof RaiseInvoice.Type;

/** Money arriving from outside, against a fee note. */
export const ReceivePayment = Schema.Struct(Billing.PaymentFields).pipe(
  Schema.filter((payment) =>
    Billing.isReconcilable(payment) ? undefined : Billing.RECONCILABLE_MESSAGE,
  ),
);

export type ReceivePayment = typeof ReceivePayment.Type;

/** Client money paid into client account. */
export const RecordDeposit = Schema.Struct({
  clientId: ClientId,
  amountCents: Schema.Int.pipe(Schema.positive()),
  receivedOn: Schema.DateFromSelf,
  reference: Schema.optional(Schema.NonEmptyTrimmedString),
});

export type RecordDeposit = typeof RecordDeposit.Type;

/**
 * Paying a fee note out of the money the firm already holds for that client.
 *
 * There is no `reason` field, and its absence is the rule. Rule 9 permits a
 * withdrawal from client account for enumerated purposes only, and the purpose
 * of *this* operation is fixed: money leaves client account because the firm's
 * costs are being taken out of it. That is "Transfer to office account for
 * costs" and it cannot be anything else. Letting a caller choose would be
 * letting a caller label a costs transfer as a refund.
 */
export const SettleFromTrust = Schema.Struct({
  amountCents: Schema.Int.pipe(Schema.positive()),
  settledOn: Schema.DateFromSelf,
});

export type SettleFromTrust = typeof SettleFromTrust.Type;

// ── Failures this layer adds ──────────────────────────────────────────────

/** 9,999 fee notes, which the `INV-nnnn` format cannot number. */
export class InvoiceNumbersExhausted extends Schema.TaggedError<InvoiceNumbersExhausted>()(
  "InvoiceNumbersExhausted",
  {},
) {
  get reason(): string {
    return (
      "Every fee-note number from INV-0001 to INV-9999 has been issued. " +
      "The format needs a fifth digit"
    );
  }
}

/**
 * A fee note that is already settled cannot be settled again.
 *
 * Distinct from `PaymentExceedsBalance`, which is about the amount offered.
 * This is about the invoice: taking costs out of client account against a fee
 * note with nothing outstanding is a withdrawal with no purpose under Rule 9,
 * whatever the amount.
 */
export class NothingOutstanding extends Schema.TaggedError<NothingOutstanding>()(
  "NothingOutstanding",
  { number: Schema.String },
) {
  get reason(): string {
    return (
      `${this.number} has nothing outstanding, so there are no costs to ` +
      `transfer out of client account against it`
    );
  }
}

/** A matter with no unbilled work on it. */
export class NothingToBill extends Schema.TaggedError<NothingToBill>()(
  "NothingToBill",
  { number: Schema.String },
) {
  get reason(): string {
    return (
      `${this.number} has no unbilled time recorded against it, so there is ` +
      `nothing to raise a fee note for`
    );
  }
}

/**
 * Somebody else billed this work between reading it and claiming it.
 *
 * The refusal that stops the same hours going onto two fee notes. It carries
 * both counts because the difference is what a person needs to see: "you asked
 * to bill twelve entries and could only claim nine" says immediately that
 * somebody else is billing this matter right now.
 */
export class TimeAlreadyBilled extends Schema.TaggedError<TimeAlreadyBilled>()(
  "TimeAlreadyBilled",
  { number: Schema.String, expected: Schema.Int, claimed: Schema.Int },
) {
  get reason(): string {
    return (
      `Some of the unbilled time on ${this.number} was carried onto another ` +
      `fee note while this one was being raised — ${String(this.claimed)} of ` +
      `${String(this.expected)} entries could be claimed. Nothing has been ` +
      `written; look at the matter's fee notes and try again`
    );
  }
}

export type CannotRaise =
  | NotPermitted
  | InvoiceNumbersExhausted
  | InvoiceNumberTaken
  | NotFound
  | RepositoryFailure;

/**
 * Everything raising a fee note *from recorded time* can fail with.
 *
 * `CannotRaise` plus the two refusals that only exist when the lines come from
 * a timesheet. Kept as a separate name rather than widening `CannotRaise`,
 * because `raise` cannot produce either of them and a caller catching them
 * there would be handling a case that never arrives — which is the kind of
 * dead branch that survives for years because nothing ever proves it wrong.
 */
export type CannotRaiseFromTime =
  CannotRaise | NothingToBill | TimeAlreadyBilled;

// ── Helpers ───────────────────────────────────────────────────────────────

const enforce = <A, E>(result: Either.Either<A, E>): Effect.Effect<A, E> =>
  Either.match(result, {
    onLeft: Effect.fail,
    onRight: Effect.succeed<A>,
  });

/**
 * The next unused fee-note number.
 *
 * Derived from what is stored rather than from a counter, and therefore a race
 * — exactly as `CaseService.nextReference` is. The same answer applies for the
 * same reason: `invoices.number` is `UNIQUE`, the loser is refused, and `raise`
 * retries. A database sequence would remove the race and hand out gaps on every
 * rollback, and a client can see a fee-note number.
 */
const nextNumber = (
  issued: readonly Billing.Invoice[],
): Either.Either<string, InvoiceNumbersExhausted> => {
  const highest = issued.reduce(
    (top, invoice) =>
      Math.max(top, Number(invoice.number.slice("INV-".length))),
    0,
  );

  return highest >= 9999
    ? Either.left(new InvoiceNumbersExhausted())
    : Either.right(`INV-${String(highest + 1).padStart(4, "0")}`);
};

const movementId = (): TrustMovementId =>
  Schema.decodeSync(TrustMovementId)(crypto.randomUUID());

/**
 * Recorded work, as fee-note lines.
 *
 * Grouped by activity and rate rather than one line per entry, because that is
 * how a bill is read: "Drafting, 12.5 hours at 20,000" rather than forty
 * separate narratives. The grouping key is the pair, not the activity alone —
 * two people at different rates doing the same work are two lines, and merging
 * them would misstate both.
 *
 * The quantity is in hundredths of an hour so the multiplication stays in
 * integer cents. Minutes are summed first and converted once: converting each
 * entry and adding would round forty times instead of once.
 */
const linesFrom = (
  entries: readonly Time.TimeEntry[],
): readonly [Billing.InvoiceLine, ...Billing.InvoiceLine[]] => {
  const grouped = new Map<
    string,
    { activity: string; rate: number; minutes: number }
  >();

  for (const entry of entries) {
    const key = `${entry.activity}@${String(entry.hourlyRateCents)}`;
    const running = grouped.get(key);
    grouped.set(key, {
      activity: entry.activity,
      rate: entry.hourlyRateCents,
      minutes: (running?.minutes ?? 0) + entry.minutes,
    });
  }

  const lines = [...grouped.values()]
    .sort((a, b) => a.activity.localeCompare(b.activity))
    .map((group): Billing.InvoiceLine => ({
      description: `${group.activity} — ${String(
        Math.round((group.minutes / 60) * 100) / 100,
      )} hours`,
      quantityHundredths: Math.round((group.minutes / 60) * 100),
      unitPriceCents: group.rate,
    }));

  const [first, ...rest] = lines;
  if (first === undefined) {
    /**
     * Unreachable: the caller refuses an empty set with `NothingToBill` before
     * getting here, and `lines` has one entry per distinct activity-and-rate.
     * It is a `throw` rather than a silent empty array because `NonEmptyArray`
     * is the domain's way of saying an invoice with nothing on it is not an
     * invoice, and quietly producing one would defeat that.
     */
    throw new Error("linesFrom called with no entries");
  }
  return [first, ...rest];
};

// ── The service ───────────────────────────────────────────────────────────

export class BillingService extends Effect.Service<BillingService>()(
  "BillingService",
  {
    effect: Effect.gen(function* () {
      const invoices = yield* InvoiceRepository;
      const clients = yield* ClientRepository;
      const cases = yield* CaseRepository;
      const time = yield* TimeRepository;
      const trust = yield* TrustRepository;
      const audit = yield* AuditLog;
      const transactor = yield* Transactor;

      const view = (invoice: Billing.Invoice, asAt: Date): InvoiceView => ({
        invoice,
        total: Billing.total(invoice),
        paid: Billing.paid(invoice),
        outstanding: Billing.outstanding(invoice),
        status: Billing.status(invoice, asAt),
        daysOverdue: Billing.daysOverdue(invoice, asAt),
      });

      /**
       * One fee note, checked against the caller's scope.
       *
       * Factored out because every write below starts this way and the checks
       * have to be identical: a portal user must not be able to reach an
       * invoice through a write path that a read path would have refused.
       * Writing the pair twice is how one of them eventually loses a line.
       */
      const scoped = (
        id: InvoiceId,
        permission: "invoice:read" | "invoice:write",
      ) =>
        Effect.gen(function* () {
          yield* permitted(permission);
          const invoice = yield* invoices.byId(id);
          yield* withinScope("invoice", id, invoice.clientId);
          return invoice;
        });

      /**
       * Every client's trust position.
       *
       * Not exposed on the service. A caller wanting one client's ledger has
       * `ledger`, which is scoped to that client; this reads across the whole
       * firm and is reached only from `receivables`, behind `trust:read` and a
       * whole-firm scope.
       */
      const trustAccounts = (): Effect.Effect<
        readonly TrustAccountView[],
        RepositoryFailure
      > =>
        Effect.gen(function* () {
          const everyClient = yield* clients.all();

          const accounts = yield* Effect.forEach(
            everyClient,
            (client) =>
              Effect.map(trust.movementsFor(client.id), (movements) => {
                const deposits = Money.sum(
                  movements
                    .filter((each) => !Ledger.isWithdrawal(each.reason))
                    .map((each) => Money.fromCents(each.amount)),
                );
                const withdrawals = Money.sum(
                  movements
                    .filter((each) => Ledger.isWithdrawal(each.reason))
                    .map((each) => Money.fromCents(each.amount)),
                );

                return {
                  clientId: client.id,
                  clientName: client.name,
                  deposits,
                  withdrawals,
                  balance: Money.subtract(deposits, withdrawals),
                } satisfies TrustAccountView;
              }),
            { concurrency: "unbounded" },
          );

          /**
           * A client with no movements has no trust account, which is a
           * different thing from one holding nothing: the firm has never held
           * money for them, and a row of zeroes on the billing screen would say
           * it once did and has since paid it all out.
           */
          return accounts.filter(
            (account) =>
              !Money.isZero(account.deposits) ||
              !Money.isZero(account.withdrawals),
          );
        });

      return {
        /**
         * Who a fee note may be raised for, and against which matter.
         *
         * Gated on `invoice:write` rather than on a read permission, because
         * that is what this is for — it is the fee-note form's list, and a
         * caller who cannot raise one has no business enumerating the firm's
         * clients from here.
         */
        choices: (): Effect.Effect<
          BillingChoices,
          NotPermitted | RepositoryFailure,
          CurrentUser
        > =>
          Effect.gen(function* () {
            yield* permitted("invoice:write");

            const [everyClient, openMatters] = yield* Effect.all(
              [clients.all(), cases.openMatters()],
              { concurrency: "unbounded" },
            );

            return {
              clients: everyClient
                .map((client) => ({ id: client.id, name: client.name }))
                .sort((a, b) => a.name.localeCompare(b.name)),
              matters: openMatters
                .map((matter) => ({
                  id: matter.id,
                  clientId: matter.clientId,
                  number: matter.number,
                  title: matter.title,
                }))
                .sort((a, b) => a.number.localeCompare(b.number)),
            };
          }),

        /** One fee note, with its derived figures. */
        invoice: (
          id: InvoiceId,
        ): Effect.Effect<
          InvoiceView,
          NotPermitted | NotFound | RepositoryFailure,
          CurrentUser
        > =>
          Effect.gen(function* () {
            const invoice = yield* scoped(id, "invoice:read");
            const asAt = yield* DateTime.nowAsDate;
            return view(invoice, asAt);
          }),

        /**
         * The fee-note page: the invoice, the two records it names, and — for
         * a caller entitled to it — what the firm holds for that client.
         *
         * `matterNumber` is looked up rather than joined for the reason every
         * other composed view gives: a repository that returned
         * invoices-with-matter-numbers would be returning something that is not
         * an `Invoice`.
         */
        feeNote: (
          id: InvoiceId,
        ): Effect.Effect<
          FeeNote,
          NotPermitted | NotFound | RepositoryFailure,
          CurrentUser
        > =>
          Effect.gen(function* () {
            const principal = yield* CurrentUser;
            const invoice = yield* scoped(id, "invoice:read");

            const [client, asAt] = yield* Effect.all([
              clients.byId(invoice.clientId),
              DateTime.nowAsDate,
            ]);

            const matter =
              invoice.caseId === undefined
                ? undefined
                : yield* Effect.map(
                    cases.findById(invoice.caseId),
                    Option.getOrUndefined,
                  );

            const held = may(principal, "trust:read")
              ? yield* Effect.map(
                  trust.movementsFor(invoice.clientId),
                  (movements) => Ledger.balanceFor(movements, invoice.clientId),
                )
              : undefined;

            return {
              view: view(invoice, asAt),
              clientName: client.name,
              ...(matter === undefined ? {} : { matterNumber: matter.number }),
              ...(held === undefined ? {} : { heldOnTrust: held }),
            } satisfies FeeNote;
          }),

        /**
         * Every fee note raised against one client.
         *
         * The client is looked up first so that an unknown id fails as
         * `NotFound` rather than succeeding with an empty list. "This client has
         * no invoices" and "there is no such client" are different answers, and
         * a caller that cannot tell them apart will show the wrong one.
         */
        forClient: (
          clientId: ClientId,
        ): Effect.Effect<
          readonly InvoiceView[],
          NotPermitted | NotFound | RepositoryFailure,
          CurrentUser
        > =>
          Effect.gen(function* () {
            yield* permitted("invoice:read");
            yield* withinScope("client", clientId, clientId);

            yield* clients.byId(clientId);

            const [raised, asAt] = yield* Effect.all([
              invoices.forClient(clientId),
              DateTime.nowAsDate,
            ]);

            // One clock reading for the whole list, so two invoices in the same
            // response cannot be judged against two different "now"s.
            return raised
              .map((invoice) => view(invoice, asAt))
              .sort(
                (a, b) =>
                  b.invoice.issuedOn.getTime() - a.invoice.issuedOn.getTime(),
              );
          }),

        /**
         * The billing screen: the firm's receivables, and the client account.
         *
         * The scope is in the query, as everywhere else — a portal user reads
         * their own fee notes and never the firm's. They also never reach the
         * trust section, because `trust:read` is not in their grants, and the
         * result says so by leaving the field absent rather than empty.
         */
        receivables: (): Effect.Effect<
          Receivables,
          NotPermitted | NotFound | RepositoryFailure,
          CurrentUser
        > =>
          Effect.gen(function* () {
            const principal = yield* permitted("invoice:read");
            const visible = yield* scope;

            const [raised, asAt] = yield* Effect.all([
              visible._tag === "WholeFirm"
                ? invoices.all()
                : invoices.forClient(visible.clientId),
              DateTime.nowAsDate,
            ]);

            const views = raised
              .map((invoice) => view(invoice, asAt))
              .sort((a, b) => a.invoice.number.localeCompare(b.invoice.number));

            const totals = {
              billed: Money.sum(views.map((each) => each.total)),
              collected: Money.sum(views.map((each) => each.paid)),
              outstanding: Money.sum(views.map((each) => each.outstanding)),
              overdue: Money.sum(
                views
                  .filter((each) => each.status === "Overdue")
                  .map((each) => each.outstanding),
              ),
            };

            /**
             * The client account, for whoever may see it.
             *
             * Checked with `may` rather than `permitted`, and this is the one
             * place in the codebase where a missing permission is not a
             * refusal: the screen is still served, with one section fewer.
             * `permitted` here would fail the whole read for a Receptionist,
             * who is entitled to the invoice half of it and holds no
             * `trust:read` — and the alternative, a second endpoint the UI
             * calls only when it thinks the permission is held, puts the
             * decision in the browser.
             *
             * The scope check beside it is not redundant. A portal user does
             * hold `invoice:read`, so without it the only thing standing
             * between them and every client's trust balance would be their
             * absence from the `trust:read` grants — one line, in one table,
             * doing all the work. Two independent conditions is the right
             * number for a read of the whole firm's client account.
             */
            const showTrust =
              may(principal, "trust:read") && visible._tag === "WholeFirm";

            if (!showTrust) return { ...totals, invoices: views };

            const accounts = yield* trustAccounts();
            return {
              ...totals,
              invoices: views,
              trust: accounts,
              trustHeld: Money.sum(accounts.map((each) => each.balance)),
            };
          }),

        /**
         * One client's trust ledger.
         *
         * Every figure is derived from the movements, including the balance —
         * `TrustRepository.balanceFor` exists and is not used here on purpose:
         * a screen that showed a stored balance beside a list of movements that
         * did not add up to it would be showing the one disagreement the ledger
         * design exists to make impossible.
         */
        ledger: (
          clientId: ClientId,
        ): Effect.Effect<
          TrustLedgerView,
          NotPermitted | NotFound | RepositoryFailure,
          CurrentUser
        > =>
          Effect.gen(function* () {
            yield* permitted("trust:read");
            yield* withinScope("client", clientId, clientId);

            const client = yield* clients.byId(clientId);
            const movements = yield* trust.movementsFor(clientId);

            return {
              clientId,
              clientName: client.name,
              balance: Ledger.balanceFor(movements, clientId),
              movements: [...movements].sort(
                (a, b) => a.recordedAt.getTime() - b.recordedAt.getTime(),
              ),
            };
          }),

        /**
         * Raises a fee note.
         *
         * Retried on a number collision for the same reason `CaseService.open`
         * is: the number is derived from what is stored, so two people raising
         * at once compute the same one and the unique index refuses the loser.
         */
        raise: (
          input: RaiseInvoice,
        ): Effect.Effect<Billing.Invoice, CannotRaise, CurrentUser> =>
          Effect.gen(function* () {
            yield* permitted("invoice:write");
            yield* clients.byId(input.clientId);

            const issued = yield* invoices.all();
            const number = yield* enforce(nextNumber(issued));

            const invoice = Billing.Invoice.make({
              ...input,
              id: Schema.decodeSync(InvoiceId)(crypto.randomUUID()),
              number,
              payments: [],
            });

            return yield* transactor.transaction(
              Effect.gen(function* () {
                const saved = yield* invoices.save(invoice);
                yield* audit.record({
                  action: "invoice.raised",
                  entity: "invoice",
                  entityId: saved.id,
                  after: saved,
                });
                return saved;
              }),
            );
          }).pipe(
            Effect.retry({
              times: 3,
              while: (error) => error._tag === "InvoiceNumberTaken",
            }),
          ),

        /**
         * Raises a fee note from the work recorded on a matter.
         *
         * The operation the whole time-tracking module exists to feed, and the
         * one place where the two modules genuinely have to be one transaction.
         *
         * ## Why the lines are grouped rather than one per entry
         *
         * Forty entries at three rates produce a fee note a client cannot read.
         * Grouping by activity and rate produces "Drafting, 12.5 hours at
         * 20,000" — which is how a bill of costs is actually presented, and is
         * the level of detail a taxing master works at. The narratives are not
         * lost: they are on the timesheet, which is what gets produced if the
         * bill is challenged.
         *
         * Quantities are in hundredths of an hour, so 12.5 hours is `1250` and
         * the multiplication happens in integer cents. A float number of hours
         * times a cent rate reintroduces the rounding `Money` exists to keep
         * out, and on a KES 480,000 bill a rounding error is visible.
         *
         * ## The race, and why the count is checked
         *
         * `carryOnto` claims the entries with `WHERE invoice_id IS NULL`, so
         * two people billing the same matter at the same moment cannot both
         * take the same hours — the second claims nothing. **This checks that
         * it got everything it asked for and fails the transaction if not.**
         * Without that check, the loser of the race would raise a fee note for
         * twelve hours having claimed none of them, and the client would be
         * billed twice for the same work by two invoices that each look
         * perfectly correct.
         */
        raiseFromTime: (
          caseId: CaseId,
          period: { readonly issuedOn: Date; readonly dueOn: Date },
        ): Effect.Effect<Billing.Invoice, CannotRaiseFromTime, CurrentUser> =>
          Effect.gen(function* () {
            yield* permitted("invoice:write");

            const matter = yield* cases.byId(caseId);
            yield* withinScope("case", caseId, matter.clientId);

            const unbilled = yield* time.unbilled(caseId);

            if (unbilled.length === 0) {
              return yield* Effect.fail(
                new NothingToBill({ number: matter.number }),
              );
            }

            const issued = yield* invoices.all();
            const number = yield* enforce(nextNumber(issued));

            const invoice = Billing.Invoice.make({
              clientId: matter.clientId,
              caseId,
              issuedOn: period.issuedOn,
              dueOn: period.dueOn,
              lines: linesFrom(unbilled),
              id: Schema.decodeSync(InvoiceId)(crypto.randomUUID()),
              number,
              payments: [],
            });

            return yield* transactor.transaction(
              Effect.gen(function* () {
                const saved = yield* invoices.save(invoice);

                const claimed = yield* time.carryOnto(
                  saved.id,
                  unbilled.map((entry) => entry.id),
                );

                /**
                 * Somebody else billed some of this work between the read and
                 * the claim. Failing the transaction is the only safe answer:
                 * the fee note about to be written charges for hours this
                 * invoice does not own, and the client would be billed for them
                 * twice.
                 */
                if (claimed !== unbilled.length) {
                  return yield* Effect.fail(
                    new TimeAlreadyBilled({
                      number: matter.number,
                      expected: unbilled.length,
                      claimed,
                    }),
                  );
                }

                yield* audit.record({
                  action: "invoice.raised",
                  entity: "invoice",
                  entityId: saved.id,
                  after: saved,
                });

                return saved;
              }),
            );
          }).pipe(
            Effect.retry({
              times: 3,
              while: (error) => error._tag === "InvoiceNumberTaken",
            }),
          ),

        /**
         * Records money received from outside against a fee note.
         *
         * The overpayment guard is the domain's — `Billing.recordPayment` —
         * and it is applied to the invoice *as stored*, so a stale form showing
         * an old balance is refused rather than accepted against figures that
         * have moved. What is then written is the payment alone, appended;
         * see `InvoiceRepository.recordPayment` for why not the whole invoice.
         */
        recordPayment: (
          id: InvoiceId,
          payment: ReceivePayment,
        ): Effect.Effect<
          InvoiceView,
          | NotPermitted
          | Billing.PaymentExceedsBalance
          | Billing.PaymentAlreadyRecorded
          | NotFound
          | RepositoryFailure,
          CurrentUser
        > =>
          Effect.gen(function* () {
            const invoice = yield* scoped(id, "invoice:write");

            const updated = yield* enforce(
              Billing.recordPayment(invoice, payment),
            );
            const asAt = yield* DateTime.nowAsDate;

            yield* transactor.transaction(
              Effect.gen(function* () {
                yield* invoices.recordPayment(id, payment);
                yield* audit.record({
                  action: "invoice.paid",
                  entity: "invoice",
                  entityId: id,
                  before: invoice,
                  after: updated,
                });
              }),
            );

            return view(updated, asAt);
          }),

        /**
         * Receives client money into client account.
         *
         * Cannot fail on a balance: Rule 4 requires client money to be paid in
         * without delay and paying in never breaches a balance. What it does
         * need is `trust:write`, and an audit entry, because a deposit that
         * nobody is recorded as having received is the first half of a
         * misappropriation.
         */
        deposit: (
          input: RecordDeposit,
        ): Effect.Effect<
          Ledger.TrustMovement,
          NotPermitted | NotFound | RepositoryFailure,
          CurrentUser
        > =>
          Effect.gen(function* () {
            yield* permitted("trust:write");
            const client = yield* clients.byId(input.clientId);

            const movement: Ledger.TrustMovement = {
              id: movementId(),
              clientId: input.clientId,
              reason: "Deposit received",
              amount: input.amountCents,
              recordedAt: input.receivedOn,
              ...(input.reference === undefined
                ? {}
                : { reference: input.reference }),
            };

            return yield* transactor.transaction(
              Effect.gen(function* () {
                const saved = yield* trust.recordDeposit(movement);
                yield* audit.record({
                  action: "trust.deposited",
                  entity: "trust",
                  entityId: client.id,
                  after: saved,
                });
                return saved;
              }),
            );
          }),

        /**
         * Takes the firm's costs out of the client money it already holds.
         *
         * The one operation in the system that can be refused by Rule 10, and
         * the refusal comes from Postgres — a trigger, because the rule needs
         * the client's whole balance and a `CHECK` sees one row. This does not
         * pre-check the balance and then write: reading first would reintroduce
         * exactly the race the trigger's `FOR UPDATE` closes, and would give a
         * confident "sufficient funds" that another settlement can invalidate
         * between the read and the insert.
         *
         * Two permissions, not one. `invoice:write` because a payment is being
         * recorded, `trust:write` because client money is leaving client
         * account. They are genuinely two acts and the roles that may do them
         * are chosen separately — see `permissions.ts`.
         */
        settle: (
          id: InvoiceId,
          input: SettleFromTrust,
        ): Effect.Effect<
          InvoiceView,
          | NotPermitted
          | NothingOutstanding
          | Billing.PaymentExceedsBalance
          | Ledger.TrustAccountUnderfunded
          | NotFound
          | RepositoryFailure,
          CurrentUser
        > =>
          Effect.gen(function* () {
            const invoice = yield* scoped(id, "invoice:write");
            yield* permitted("trust:write");

            if (Money.isZero(Billing.outstanding(invoice))) {
              return yield* Effect.fail(
                new NothingOutstanding({ number: invoice.number }),
              );
            }

            const payment: Billing.Payment = {
              amountCents: input.amountCents,
              method: "Bank Transfer",
              receivedOn: input.settledOn,
              reference: `Costs transfer against ${invoice.number}`,
            };

            // The overpayment guard, before anything is written. A settlement
            // that overpays a fee note would leave the surplus as firm money
            // taken out of client account, which is the Rule 9 breach.
            const updated = yield* enforce(
              Billing.recordPayment(invoice, payment),
            );

            const movement: Ledger.TrustMovement = {
              id: movementId(),
              clientId: invoice.clientId,
              reason: "Transfer to office account for costs",
              amount: input.amountCents,
              recordedAt: input.settledOn,
              reference: invoice.number,
            };

            const asAt = yield* DateTime.nowAsDate;

            yield* transactor.transaction(
              Effect.gen(function* () {
                yield* invoices.settleFromTrust({
                  invoiceId: id,
                  payment,
                  movement,
                });
                yield* audit.record({
                  action: "invoice.settled",
                  entity: "invoice",
                  entityId: id,
                  before: invoice,
                  after: updated,
                });
              }),
            );

            return view(updated, asAt);
          }),
      };
    }),
  },
) {}
