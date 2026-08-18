import { Either, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { ClientId, TrustMovementId } from "../shared/ids";
import * as Money from "../shared/money";
import * as Ledger from "./ledger";

const clientId = (n: number) =>
  Schema.decodeSync(ClientId)(`00000000-0000-4000-8000-00000000000${n}`);

let sequence = 0;
const movementId = () => {
  sequence += 1;
  return Schema.decodeSync(TrustMovementId)(
    `10000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
  );
};

const shillings = (amount: number) => Money.fromCents(amount * 100);
const at = new Date("2026-08-19T09:00:00Z");

const wanjiku = clientId(1);
const generalInnovations = clientId(2);

const deposit = (
  movements: readonly Ledger.TrustMovement[],
  client: ClientId,
  amount: number,
) =>
  Ledger.recordDeposit(movements, {
    id: movementId(),
    clientId: client,
    amount: shillings(amount),
    recordedAt: at,
  });

const withdraw = (
  movements: readonly Ledger.TrustMovement[],
  client: ClientId,
  amount: number,
  reason: Ledger.MovementReason = "Payment on behalf of client",
) =>
  Ledger.recordWithdrawal(movements, {
    id: movementId(),
    clientId: client,
    reason,
    amount: shillings(amount),
    recordedAt: at,
  });

describe("balances", () => {
  it("is zero for a client with no movements", () => {
    expect(Ledger.balanceFor([], wanjiku)).toBe(0);
  });

  it("adds deposits and subtracts withdrawals", () => {
    let ledger = deposit([], wanjiku, 500_000);
    ledger = Either.getOrThrow(withdraw(ledger, wanjiku, 120_000));

    expect(Ledger.balanceFor(ledger, wanjiku)).toBe(shillings(380_000));
  });

  it("keeps each client's money separate", () => {
    let ledger = deposit([], wanjiku, 200_000);
    ledger = deposit(ledger, generalInnovations, 900_000);

    expect(Ledger.balanceFor(ledger, wanjiku)).toBe(shillings(200_000));
    expect(Ledger.balanceFor(ledger, generalInnovations)).toBe(
      shillings(900_000),
    );
    expect(Ledger.totalHeld(ledger)).toBe(shillings(1_100_000));
  });
});

describe("Rule 10 — no withdrawal beyond that client's credit", () => {
  it("allows a withdrawal up to the exact balance", () => {
    const ledger = deposit([], wanjiku, 250_000);
    const result = withdraw(ledger, wanjiku, 250_000);

    expect(Either.isRight(result)).toBe(true);
    expect(Ledger.balanceFor(Either.getOrThrow(result), wanjiku)).toBe(0);
  });

  it("refuses a withdrawal one cent over the balance", () => {
    const ledger = deposit([], wanjiku, 250_000);
    const result = Ledger.recordWithdrawal(ledger, {
      id: movementId(),
      clientId: wanjiku,
      reason: "Payment to client",
      amount: Money.fromCents(250_000_00 + 1),
      recordedAt: at,
    });

    expect(Either.isLeft(result)).toBe(true);
  });

  /**
   * The case the rule actually exists for. The firm is holding plenty of money
   * overall, and the bank would clear the payment — but not this client's
   * money. A check against the firm total would wrongly allow it.
   */
  it("refuses an overdraw even when the firm holds far more for others", () => {
    let ledger = deposit([], wanjiku, 200_000);
    ledger = deposit(ledger, generalInnovations, 5_000_000);

    expect(Ledger.totalHeld(ledger)).toBe(shillings(5_200_000));

    const result = withdraw(ledger, wanjiku, 300_000);

    expect(Either.isLeft(result)).toBe(true);
    const error = Option.getOrThrow(Either.getLeft(result));
    expect(error._tag).toBe("TrustAccountUnderfunded");
  });

  it("explains a refusal by citing the rule", () => {
    const ledger = deposit([], wanjiku, 10_000);
    const result = withdraw(ledger, wanjiku, 40_000);

    const error = Option.getOrThrow(Either.getLeft(result));
    expect(error).toBeInstanceOf(Ledger.TrustAccountUnderfunded);
    if (error instanceof Ledger.TrustAccountUnderfunded) {
      expect(error.reason).toContain("r. 10");
      expect(error.held).toBe(shillings(10_000));
      expect(error.requested).toBe(shillings(40_000));
    }
  });

  it("leaves the ledger untouched when it refuses", () => {
    const ledger = deposit([], wanjiku, 10_000);
    const before = [...ledger];

    withdraw(ledger, wanjiku, 40_000);

    expect(ledger).toStrictEqual(before);
    expect(Ledger.balanceFor(ledger, wanjiku)).toBe(shillings(10_000));
  });

  it("refuses to treat a deposit as a withdrawal", () => {
    const result = withdraw([], wanjiku, 1_000, "Deposit received");
    const error = Option.getOrThrow(Either.getLeft(result));
    expect(error._tag).toBe("NotAWithdrawal");
  });
});

describe("the invariant holds over a sequence of movements", () => {
  it("never lets any client go negative, however the operations interleave", () => {
    let ledger: readonly Ledger.TrustMovement[] = [];
    const clients = [wanjiku, generalInnovations];

    // Deposit, then repeatedly attempt withdrawals of varying size. Those that
    // would breach Rule 10 are refused; the rest apply. No sequence of accepted
    // operations may leave a client overdrawn.
    for (const client of clients) {
      ledger = deposit(ledger, client, 100_000);
    }

    for (let attempt = 1; attempt <= 40; attempt++) {
      const client = clients[attempt % clients.length]!;
      const result = withdraw(ledger, client, attempt * 7_000);
      if (Either.isRight(result)) ledger = result.right;

      expect(Ledger.overdrawnClients(ledger)).toStrictEqual([]);
      expect(Money.isNegative(Ledger.balanceFor(ledger, client))).toBe(false);
    }
  });

  it("reports a client overdrawn by movements written around the guard", () => {
    // Simulates imported or hand-edited data bypassing recordWithdrawal —
    // exactly what Phase 2 runs this check against after a migration.
    const smuggled: readonly Ledger.TrustMovement[] = [
      {
        id: movementId(),
        clientId: wanjiku,
        reason: "Payment to client",
        amount: shillings(50_000),
        recordedAt: at,
      },
    ];

    expect(Ledger.overdrawnClients(smuggled)).toStrictEqual([wanjiku]);
  });
});

describe("TrustMovement schema", () => {
  it("rejects a non-positive amount", () => {
    const result = Schema.decodeUnknownEither(Ledger.TrustMovement)({
      id: movementId(),
      clientId: wanjiku,
      reason: "Deposit received",
      amount: -5000,
      recordedAt: at,
    });

    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects a reason outside Rule 9's permitted purposes", () => {
    const result = Schema.decodeUnknownEither(Ledger.TrustMovement)({
      id: movementId(),
      clientId: wanjiku,
      reason: "Miscellaneous",
      amount: 5000,
      recordedAt: at,
    });

    expect(Either.isLeft(result)).toBe(true);
  });
});
