import { Effect, Exit, ManagedRuntime } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Billing from "../../domain/billing/invoice";
import * as ClientDomain from "../../domain/client/client";
import * as Money from "../../domain/shared/money";
import {
  AdvocateRepository,
  CaseRepository,
  ClientRepository,
  InvoiceRepository,
  TrustRepository,
} from "../../services/repositories";
import { seed, SeedLayer } from "./program";
import { AS_AT } from "./supplement";

/**
 * The import, end to end, and then read back through the repositories.
 *
 * This is the Phase 2 "done when": the seed data lives in Postgres and comes
 * out as domain entities. Running the real script rather than a reconstruction
 * of it is the point — a test that reimplements the import proves the test
 * works.
 *
 * It runs the seed **twice**. Idempotence is the property that makes derived
 * ids worth the trouble, and the only way to observe it is to import the same
 * dataset onto itself and find one firm rather than two.
 */

const hasDatabase = Boolean(process.env["DATABASE_URL"]);
const describeIfDb = hasDatabase ? describe : describe.skip;

const runtime = ManagedRuntime.make(SeedLayer);

const run = <A, E>(
  effect: Effect.Effect<
    A,
    E,
    | AdvocateRepository
    | CaseRepository
    | ClientRepository
    | InvoiceRepository
    | TrustRepository
  >,
) => runtime.runPromiseExit(effect);

beforeAll(async () => {
  if (!hasDatabase) return;

  const first = await runtime.runPromiseExit(seed);
  expect(Exit.isSuccess(first)).toBe(true);

  const second = await runtime.runPromiseExit(seed);
  expect(Exit.isSuccess(second)).toBe(true);
}, 180_000);

afterAll(async () => {
  if (!hasDatabase) return;
  await runtime.dispose();
}, 60_000);

describeIfDb("the seeded dataset", () => {
  it("imports the firm exactly once, however many times it runs", async () => {
    const exit = await run(
      Effect.all({
        staff: Effect.flatMap(AdvocateRepository, (repo) => repo.all()),
        clients: Effect.flatMap(ClientRepository, (repo) => repo.all()),
        matters: Effect.flatMap(CaseRepository, (repo) => repo.openMatters()),
      }),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.staff).toHaveLength(6);
      expect(exit.value.clients).toHaveLength(6);
      // Eight matters, one of them closed.
      expect(exit.value.matters).toHaveLength(7);
    }
  });

  it("brings a matter back with the court the free text meant", async () => {
    const exit = await run(
      Effect.flatMap(CaseRepository, (repo) => repo.openMatters()),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      const civil = exit.value.find((each) => each.number === "OKL-2026-014");

      expect(civil?.court).toStrictEqual({
        _tag: "MagistratesCourt",
        station: "Milimani",
        rank: "Chief Magistrate",
      });
      expect(civil?.filedOn).toStrictEqual(
        new Date("2026-02-14T00:00:00.000Z"),
      );
      expect(civil?.claimValueCents).toBe(4_200_000_00);
    }
  });

  it("brings a company back with the person who can instruct the firm", async () => {
    const exit = await run(
      Effect.flatMap(ClientRepository, (repo) => repo.all()),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      const company = exit.value.find(
        (each) => each.name === "General Innovations Ltd",
      );

      expect(company?._tag).toBe("Corporate");
      expect(ClientDomain.primaryContact(company!)).toBe("Peter Kamau");
      // KRA issues P pins to entities and A pins to individuals.
      expect(company!.kraPin).toMatch(/^P/);
    }
  });

  /**
   * The status the prototype stored as a tag, arrived at from the stored lines
   * and payments instead. If the import had written the tag, this would be
   * checking that a string equals itself.
   */
  it("derives each invoice's status from what is actually stored", async () => {
    const exit = await run(
      Effect.gen(function* () {
        const clients = yield* Effect.flatMap(ClientRepository, (repo) =>
          repo.all(),
        );
        const repo = yield* InvoiceRepository;
        return yield* Effect.forEach(clients, (client) =>
          repo.forClient(client.id),
        );
      }),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      const all = exit.value.flat();
      expect(all).toHaveLength(6);

      const statuses = Object.fromEntries(
        all.map((invoice) => [invoice.number, Billing.status(invoice, AS_AT)]),
      );

      expect(statuses).toStrictEqual({
        "INV-3001": "Paid",
        "INV-3002": "Partially Paid",
        "INV-3003": "Overdue",
        "INV-3004": "Paid",
        "INV-3005": "Partially Paid",
        "INV-3006": "Overdue",
      });
    }
  });

  /**
   * The gate the roadmap asks for, run against the database rather than the
   * adapted values. A demo that ships with a Rule 10 breach baked into it
   * teaches the wrong thing.
   */
  it("leaves no client overdrawn on trust", async () => {
    const exit = await run(
      Effect.gen(function* () {
        const trust = yield* TrustRepository;
        const clients = yield* Effect.flatMap(ClientRepository, (repo) =>
          repo.all(),
        );

        return {
          overdrawn: yield* trust.overdrawn(),
          held: yield* Effect.forEach(clients, (client) =>
            trust.balanceFor(client.id),
          ),
        };
      }),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.overdrawn).toStrictEqual([]);
      expect(Money.sum(exit.value.held)).toBe(Money.fromCents(240_000_00));
    }
  });
});
