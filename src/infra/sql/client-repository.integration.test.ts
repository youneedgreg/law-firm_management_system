import { SqlClient } from "@effect/sql";
import { Effect, Exit, Layer, ManagedRuntime, Schema } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Client from "../../domain/client/client";
import { ClientId, KenyanPhone } from "../../domain/shared/ids";
import { ClientRepository } from "../../services/repositories";
import { PgLive } from "./client";
import { ClientRepositoryLive } from "./client-repository";

/**
 * `ClientRepository` against a real Postgres.
 *
 * A client is stored across two tables, so this is the first repository whose
 * writes are not a single statement. The questions only a database answers:
 * whether replacing a contact list actually replaces it, and whether the order
 * the caller gave survives storage — because `contacts[0]` is the person the
 * firm takes instructions from, and a set has no first element.
 */

const hasDatabase = Boolean(process.env["DATABASE_URL"]);
const describeIfDb = hasDatabase ? describe : describe.skip;

const runtime = ManagedRuntime.make(
  ClientRepositoryLive.pipe(Layer.provideMerge(PgLive)),
);

const run = <A, E>(effect: Effect.Effect<A, E, ClientRepository>) =>
  runtime.runPromiseExit(effect);

const raw = <T extends object>(sql: string, params: readonly unknown[] = []) =>
  runtime.runPromise(
    Effect.flatMap(SqlClient.SqlClient, (client) =>
      client.unsafe<T>(sql, params as never),
    ),
  );

const personId = Schema.decodeSync(ClientId)(
  "dddddddd-0000-4000-8000-000000000001",
);
const companyId = Schema.decodeSync(ClientId)(
  "dddddddd-0000-4000-8000-000000000002",
);
const phone = Schema.decodeSync(KenyanPhone)("+254722445109");

const person = Client.Individual.make({
  id: personId,
  number: "CLT-7101",
  name: "Wanjiku Mwangi",
  email: "wanjiku@example.co.ke",
  phone,
  onboardedOn: new Date("2026-01-10T00:00:00.000Z"),
});

const grace: Client.ClientContact = {
  name: "Grace Otieno",
  role: "Company Secretary",
  phone,
};
const peter: Client.ClientContact = {
  name: "Peter Kimani",
  role: "Finance Director",
  email: "pk@zenith.co.ke",
};
const mary: Client.ClientContact = { name: "Mary Njeri", role: "Director" };

const company = Client.Corporate.make({
  id: companyId,
  number: "CLT-7102",
  name: "Zenith Distributors Ltd",
  email: "legal@zenith.co.ke",
  phone,
  onboardedOn: new Date("2026-01-12T00:00:00.000Z"),
  contacts: [grace, peter, mary],
  registrationNumber: "PVT-9XYZ123",
});

const cleanUp = async () => {
  await raw(`DELETE FROM clients WHERE id = ANY($1)`, [[personId, companyId]]);
};

beforeAll(async () => {
  if (!hasDatabase) return;
  await cleanUp();
}, 60_000);

afterAll(async () => {
  if (!hasDatabase) return;
  await cleanUp();
  await runtime.dispose();
}, 60_000);

describeIfDb("ClientRepository against Postgres", () => {
  it("stores an individual and reads it back unchanged", async () => {
    const exit = await run(
      Effect.gen(function* () {
        const repo = yield* ClientRepository;
        yield* repo.save(person);
        return yield* repo.byId(personId);
      }),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value).toStrictEqual(person);
  });

  it("stores a company with its contacts in the order given", async () => {
    const exit = await run(
      Effect.gen(function* () {
        const repo = yield* ClientRepository;
        yield* repo.save(company);
        return yield* repo.byId(companyId);
      }),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toStrictEqual(company);
      expect(Client.primaryContact(exit.value)).toBe("Grace Otieno");
    }
  });

  it("writes the ordering column the read relies on", async () => {
    const rows = await raw<{ readonly ordinal: number; readonly name: string }>(
      `SELECT name, ordinal FROM client_contacts WHERE client_id = $1 ORDER BY ordinal`,
      [companyId],
    );

    expect(rows.map((row) => [row.ordinal, row.name])).toStrictEqual([
      [0, "Grace Otieno"],
      [1, "Peter Kimani"],
      [2, "Mary Njeri"],
    ]);
  });

  /**
   * The failure mode a naive `save` has: contacts accumulate instead of being
   * replaced, and the list grows by three every time anyone edits a phone
   * number.
   */
  it("replaces the contact list rather than appending to it", async () => {
    const trimmed = Client.Corporate.make({
      ...company,
      contacts: [{ name: "Peter Kimani", role: "Managing Director" }],
    });

    const exit = await run(
      Effect.gen(function* () {
        const repo = yield* ClientRepository;
        yield* repo.save(trimmed);
        return yield* repo.byId(companyId);
      }),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value).toStrictEqual(trimmed);

    const rows = await raw<{ readonly n: string }>(
      `SELECT count(*) AS n FROM client_contacts WHERE client_id = $1`,
      [companyId],
    );

    expect(Number(rows[0]?.n)).toBe(1);
  });

  it("reorders contacts when the caller reorders them", async () => {
    const reordered = Client.Corporate.make({
      ...company,
      contacts: [peter, grace],
    });

    const exit = await run(
      Effect.gen(function* () {
        const repo = yield* ClientRepository;
        yield* repo.save(reordered);
        return yield* repo.byId(companyId);
      }),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(Client.primaryContact(exit.value)).toBe("Peter Kimani");
    }
  });

  it("lists every client, by client number", async () => {
    const exit = await run(
      Effect.flatMap(ClientRepository, (repo) => repo.all()),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      const numbers = exit.value.map((client) => client.number);
      expect(numbers).toStrictEqual([...numbers].sort());
      expect(numbers).toContain("CLT-7101");
      expect(numbers).toContain("CLT-7102");
    }
  });

  it("does not attach one client's contacts to another", async () => {
    const exit = await run(
      Effect.flatMap(ClientRepository, (repo) => repo.byId(personId)),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value._tag).toBe("Individual");
  });

  it("reports a missing client as NotFound", async () => {
    const missing = Schema.decodeSync(ClientId)(
      "dddddddd-0000-4000-8000-000000000099",
    );

    const exit = await run(
      Effect.flatMap(ClientRepository, (repo) => repo.byId(missing)),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    const error = Exit.isFailure(exit)
      ? (exit.cause as { error?: { _tag?: string } }).error
      : undefined;
    expect(error?._tag).toBe("NotFound");
  });

  /**
   * The refusal that the schema cannot make: `NOT NULL` cannot require a row in
   * another table. Written here with raw SQL precisely because the repository
   * will not produce it — the point is that a row put there by anything else is
   * still refused on the way out.
   */
  it("refuses to read a corporate client with no contacts", async () => {
    await raw(`DELETE FROM client_contacts WHERE client_id = $1`, [companyId]);

    const exit = await run(
      Effect.flatMap(ClientRepository, (repo) => repo.byId(companyId)),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    const error = Exit.isFailure(exit)
      ? (exit.cause as { error?: { _tag?: string; detail?: string } }).error
      : undefined;
    expect(error?._tag).toBe("RepositoryFailure");
    expect(error?.detail).toContain("no contacts");
  });
});
