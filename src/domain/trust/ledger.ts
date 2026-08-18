import { Either, Schema } from "effect";
import { ClientId, TrustMovementId } from "../shared/ids";
import * as Money from "../shared/money";

/**
 * The client trust ledger, under the Advocates (Accounts) Rules (LN 137/1966).
 * See docs/domain-notes.md §2.
 *
 * Three rules shape this module, and each one shows up as a type rather than a
 * comment:
 *
 * **Rule 10** — an advocate may never withdraw "any sum in excess of the amount
 * held for the time being in such account for the credit of the client". Note
 * *the client*, singular. A firm holding KES 5,000,000 across twenty clients
 * may not pay out KES 300,000 for a client whose own balance is KES 200,000,
 * even though the bank would honour it. So the ledger is keyed by client and a
 * withdrawal returns `Either`.
 *
 * **Rule 9** — withdrawals are permitted only for enumerated purposes, so a
 * movement carries a reason from a closed union, not a free-text memo.
 *
 * **Rule 4** — client money is paid in "without delay", and client money is
 * never firm money. Nothing here can move funds between the two; that is a
 * different operation with its own authorisation, deliberately not modelled as
 * a ledger movement.
 *
 * The balance is *derived* from movements, never stored. A stored balance can
 * disagree with its own history, and this is precisely the number that must
 * not. Every figure is reconstructable from the movement list.
 */

// ── Movements ─────────────────────────────────────────────────────────────

/** Rule 9's permitted purposes, plus the deposit side. */
export const MOVEMENT_REASONS = [
  "Deposit received",
  "Payment to client",
  "Payment on behalf of client",
  "Transfer to office account for costs",
  "Reimbursement of disbursement",
  "Refund of unused balance",
] as const;

export const MovementReason = Schema.Literal(...MOVEMENT_REASONS);
export type MovementReason = typeof MovementReason.Type;

/** Reasons that move money out. Everything else pays in. */
const WITHDRAWAL_REASONS: ReadonlySet<MovementReason> = new Set([
  "Payment to client",
  "Payment on behalf of client",
  "Transfer to office account for costs",
  "Reimbursement of disbursement",
  "Refund of unused balance",
]);

export const isWithdrawal = (reason: MovementReason): boolean =>
  WITHDRAWAL_REASONS.has(reason);

/**
 * One entry in the ledger.
 *
 * `amount` is always positive; direction comes from the reason. Signed amounts
 * would let a "deposit" of minus five thousand pass every type check in the
 * system while quietly emptying an account.
 */
export const TrustMovement = Schema.Struct({
  id: TrustMovementId,
  clientId: ClientId,
  reason: MovementReason,
  amount: Schema.Int.pipe(Schema.positive()),
  recordedAt: Schema.DateFromSelf,
  /** The matter this movement relates to, where there is one. */
  reference: Schema.optional(Schema.String),
});

export type TrustMovement = typeof TrustMovement.Type;

// ── Failures ──────────────────────────────────────────────────────────────

export class TrustAccountUnderfunded extends Schema.TaggedError<TrustAccountUnderfunded>()(
  "TrustAccountUnderfunded",
  {
    clientId: Schema.String,
    held: Schema.Number,
    requested: Schema.Number,
  },
) {
  get reason(): string {
    return (
      `Cannot withdraw ${Money.format(this.requested as Money.Money)} against a ` +
      `client balance of ${Money.format(this.held as Money.Money)}. ` +
      `An advocate may not withdraw more than is held for the credit of that ` +
      `client (Advocates (Accounts) Rules, r. 10)`
    );
  }
}

export class NotAWithdrawal extends Schema.TaggedError<NotAWithdrawal>()(
  "NotAWithdrawal",
  { reason: MovementReason },
) {}

// ── Balances ──────────────────────────────────────────────────────────────

/**
 * What is held for one client, derived from that client's movements.
 *
 * Filters by client rather than trusting the caller to pass a pre-filtered
 * list: handing this function the whole firm's ledger and getting one client's
 * balance back is the safe default, and mixing clients is the mistake Rule 10
 * exists to prevent.
 */
export const balanceFor = (
  movements: readonly TrustMovement[],
  clientId: ClientId,
): Money.Money =>
  movements
    .filter((movement) => movement.clientId === clientId)
    .reduce<Money.Money>(
      (running, movement) =>
        isWithdrawal(movement.reason)
          ? Money.subtract(running, Money.fromCents(movement.amount))
          : Money.add(running, Money.fromCents(movement.amount)),
      Money.zero,
    );

/** Balances for every client appearing in the ledger. */
export const balances = (
  movements: readonly TrustMovement[],
): ReadonlyMap<ClientId, Money.Money> => {
  const result = new Map<ClientId, Money.Money>();
  for (const movement of movements) {
    result.set(movement.clientId, balanceFor(movements, movement.clientId));
  }
  return result;
};

/**
 * Total client money the firm holds.
 *
 * Deliberately *not* the number any withdrawal is checked against — see
 * `recordWithdrawal`. It exists for the balance sheet, where the firm's total
 * obligation to its clients is the meaningful figure.
 */
export const totalHeld = (movements: readonly TrustMovement[]): Money.Money =>
  Money.sum([...balances(movements).values()]);

// ── Recording ─────────────────────────────────────────────────────────────

export interface WithdrawalRequest {
  readonly id: TrustMovementId;
  readonly clientId: ClientId;
  readonly reason: MovementReason;
  readonly amount: Money.Money;
  readonly recordedAt: Date;
  readonly reference?: string | undefined;
}

/**
 * Records a withdrawal, or refuses it under Rule 10.
 *
 * The check is against `balanceFor(movements, request.clientId)` — that one
 * client's credit — and never against `totalHeld`. That distinction is the
 * whole rule.
 */
export const recordWithdrawal = (
  movements: readonly TrustMovement[],
  request: WithdrawalRequest,
): Either.Either<
  readonly TrustMovement[],
  TrustAccountUnderfunded | NotAWithdrawal
> => {
  if (!isWithdrawal(request.reason)) {
    return Either.left(new NotAWithdrawal({ reason: request.reason }));
  }

  const held = balanceFor(movements, request.clientId);

  if (Money.greaterThan(request.amount, held)) {
    return Either.left(
      new TrustAccountUnderfunded({
        clientId: request.clientId,
        held,
        requested: request.amount,
      }),
    );
  }

  return Either.right([
    ...movements,
    {
      id: request.id,
      clientId: request.clientId,
      reason: request.reason,
      amount: request.amount,
      recordedAt: request.recordedAt,
      ...(request.reference === undefined
        ? {}
        : { reference: request.reference }),
    },
  ]);
};

/**
 * Records a deposit. Cannot fail: Rule 4 requires client money to be paid in
 * without delay, and paying in never breaches a balance.
 */
export const recordDeposit = (
  movements: readonly TrustMovement[],
  request: Omit<WithdrawalRequest, "reason">,
): readonly TrustMovement[] => [
  ...movements,
  {
    id: request.id,
    clientId: request.clientId,
    reason: "Deposit received",
    amount: request.amount,
    recordedAt: request.recordedAt,
    ...(request.reference === undefined
      ? {}
      : { reference: request.reference }),
  },
];

/**
 * Whether the ledger holds together: no client is overdrawn.
 *
 * A negative client balance means Rule 10 was breached somewhere upstream —
 * a movement written directly rather than through `recordWithdrawal`, or data
 * imported from elsewhere. Phase 2 runs this after every migration and import.
 */
export const overdrawnClients = (
  movements: readonly TrustMovement[],
): readonly ClientId[] =>
  [...balances(movements).entries()]
    .filter(([, balance]) => Money.isNegative(balance))
    .map(([clientId]) => clientId);
