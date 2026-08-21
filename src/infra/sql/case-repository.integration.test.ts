import { SqlClient } from "@effect/sql";
import { Effect, Exit, Layer, ManagedRuntime, Option, Schema } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Matter from "../../domain/case/case";
import * as Court from "../../domain/court/court";
import {
  AdvocateId,
  CaseId,
  CaseNumber,
  ClientId,
} from "../../domain/shared/ids";
import { CaseRepository } from "../../services/repositories";
import { CaseRepositoryLive } from "./case-repository";
import { PgLive } from "./client";

/**
 * `CaseRepository` against a real Postgres.
 *
 * The mapping itself is covered hermetically in `case-model.test.ts`; what only
 * a database can answer is whether the SQL those mappings feed is well-formed —
 * whether `sql.insert` names the columns Postgres expects, whether a `date`
 * column survives the driver in both directions, and whether the upsert really
 * updates rather than duplicating.
 *
 * Runs only when `DATABASE_URL` is set. Point it at a Neon branch: it writes
 * rows and deletes them again.
 */

const hasDatabase = Boolean(process.env["DATABASE_URL"]);
const describeIfDb = hasDatabase ? describe : describe.skip;

const layer = CaseRepositoryLive.pipe(Layer.provideMerge(PgLive));

const clientId = Schema.decodeSync(ClientId)(
  "aaaaaaaa-0000-4000-8000-000000000001",
);
const otherClientId = Schema.decodeSync(ClientId)(
  "aaaaaaaa-0000-4000-8000-000000000002",
);
const advocateId = Schema.decodeSync(AdvocateId)(
  "bbbbbbbb-0000-4000-8000-000000000001",
);

const caseId = (n: number) =>
  Schema.decodeSync(CaseId)(
    `cccccccc-0000-4000-8000-${String(n).padStart(12, "0")}`,
  );

/**
 * A matter, decoded rather than cast.
 *
 * It was `({ … }) as Matter.Case`, and the cast hid a real regression for two
 * slices: `Case` gained a required `opposingParties` when the conflict screen
 * was connected, this fixture never grew one, and `as` silenced the compiler
 * while every save failed against real Postgres. The unit suite stayed green
 * because it does not touch a database, and nobody ran the integration suite.
 *
 * `decodeSync` over `typeSchema` is the fix and the lesson: a fixture that
 * decodes cannot drift from the domain, because adding a required field breaks
 * it here at the same moment it breaks everywhere else.
 */
const matter = (n: number, overrides: Partial<Matter.Case> = {}): Matter.Case =>
  Schema.decodeSync(Schema.typeSchema(Matter.Case))({
    id: caseId(n),
    number: Schema.decodeSync(CaseNumber)(
      `OKL-2099-${String(n).padStart(3, "0")}`,
    ),
    title: "Wanjiku Mwangi v. Nairobi Metro SACCO",
    type: "Civil",
    status: "New",
    clientId,
    advocateId,
    underCustomaryLaw: false,
    opposingParties: ["Nairobi Metro SACCO"],
    openedOn: new Date("2026-02-14T00:00:00.000Z"),
    ...overrides,
  });

/**
 * One runtime for the file, not one per call.
 *
 * `Effect.provide(layer)` per test builds a fresh connection pool each time,
 * and against a database several hundred milliseconds away that dominates the
 * run. A `ManagedRuntime` builds the layer once and hands every test the same
 * pool.
 */
const runtime = ManagedRuntime.make(layer);

// The return type is inferred: building the layer can itself fail (a bad
// `DATABASE_URL`, an unreachable host), so the error channel is wider than the
// effect's own.
const run = <A, E>(effect: Effect.Effect<A, E, CaseRepository>) =>
  runtime.runPromiseExit(effect);

/** Columns come back camelCase: `PgLive` transforms result names. */
const raw = <T extends object>(sql: string, params: readonly unknown[] = []) =>
  runtime.runPromise(
    Effect.flatMap(SqlClient.SqlClient, (client) =>
      client.unsafe<T>(sql, params as never),
    ),
  );

const cleanUp = async () => {
  await raw(`DELETE FROM cases WHERE advocate_id = $1`, [advocateId]);
  await raw(`DELETE FROM clients WHERE id = ANY($1)`, [
    [clientId, otherClientId],
  ]);
  await raw(`DELETE FROM advocates WHERE id = $1`, [advocateId]);
};

beforeAll(async () => {
  if (!hasDatabase) return;
  await cleanUp();

  await raw(
    `INSERT INTO advocates (id, name, role, email, active)
     VALUES ($1, 'Case Probe', 'Advocate', 'cases@example.co.ke', true)`,
    [advocateId],
  );
  await raw(
    `INSERT INTO clients (id, number, kind, name, email, phone, onboarded_on)
     VALUES ($1, 'CLT-7001', 'Individual', 'Case Probe',
             'cases@example.co.ke', '+254722445109', '2026-01-10'),
            ($2, 'CLT-7002', 'Individual', 'Other Probe',
             'other@example.co.ke', '+254722445110', '2026-01-10')`,
    [clientId, otherClientId],
  );
}, 60_000);

afterAll(async () => {
  if (!hasDatabase) return;
  await cleanUp();
  await runtime.dispose();
}, 60_000);

describeIfDb("CaseRepository against Postgres", () => {
  it("stores a bare matter and reads it back unchanged", async () => {
    const original = matter(1);

    const exit = await run(
      Effect.gen(function* () {
        const repo = yield* CaseRepository;
        yield* repo.save(original);
        return yield* repo.byId(original.id);
      }),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value).toStrictEqual(original);
  });

  /**
   * The row that exercises every awkward column at once: a court spread across
   * four of them, a `bigint` that arrives as a string, and two `date` columns
   * that the driver parses at local midnight.
   */
  it("stores a fully specified matter and reads it back unchanged", async () => {
    const original = matter(2, {
      causeNumber: "HCCC E123 of 2026",
      status: "Hearing Scheduled",
      court: Court.MagistratesCourt.make({
        station: "Milimani",
        rank: "Chief Magistrate",
      }),
      claimValueCents: 18_000_000_00,
      accruedOn: new Date("2025-11-02T00:00:00.000Z"),
      limitationBasis: "contract",
      filedOn: new Date("2026-03-01T00:00:00.000Z"),
    });

    const exit = await run(
      Effect.gen(function* () {
        const repo = yield* CaseRepository;
        yield* repo.save(original);
        return yield* repo.byId(original.id);
      }),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value).toStrictEqual(original);
  });

  it("saves an unfiled matter with a null filing date, not the epoch", async () => {
    const rows = await raw<{ readonly filedOn: unknown }>(
      `SELECT filed_on FROM cases WHERE id = $1`,
      [caseId(1)],
    );

    expect(rows[0]?.filedOn).toBeNull();
  });

  it("updates in place rather than inserting a second row", async () => {
    const exit = await run(
      Effect.gen(function* () {
        const repo = yield* CaseRepository;
        yield* repo.save(matter(1, { status: "Active", title: "Renamed" }));
        return yield* repo.byId(caseId(1));
      }),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.status).toBe("Active");
      expect(exit.value.title).toBe("Renamed");
    }

    const rows = await raw<{ readonly n: string }>(
      `SELECT count(*) AS n FROM cases WHERE id = $1`,
      [caseId(1)],
    );

    expect(Number(rows[0]?.n)).toBe(1);
  });

  it("reports a missing matter as NotFound rather than an empty result", async () => {
    const exit = await run(
      Effect.flatMap(CaseRepository, (repo) => repo.byId(caseId(99))),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    const error = Exit.isFailure(exit)
      ? (exit.cause as { error?: { _tag?: string } }).error
      : undefined;
    expect(error?._tag).toBe("NotFound");
  });

  it("returns None from findById, which is not a failure", async () => {
    const exit = await run(
      Effect.flatMap(CaseRepository, (repo) => repo.findById(caseId(99))),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(Option.isNone(exit.value)).toBe(true);
  });

  it("returns only the matters belonging to the client asked for", async () => {
    const exit = await run(
      Effect.gen(function* () {
        const repo = yield* CaseRepository;
        yield* repo.save(matter(3, { clientId: otherClientId }));
        return yield* repo.forClient(clientId);
      }),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.map((m) => m.id).sort()).toStrictEqual(
        [caseId(1), caseId(2)].sort(),
      );
    }
  });

  it("leaves closed matters out of the open list", async () => {
    const exit = await run(
      Effect.gen(function* () {
        const repo = yield* CaseRepository;
        yield* repo.save(matter(4, { status: "Closed" }));
        return yield* repo.openMatters();
      }),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      const ids = exit.value.map((m) => m.id);
      expect(ids).toContain(caseId(1));
      expect(ids).not.toContain(caseId(4));
    }
  });

  /**
   * A duplicate matter number is `CaseNumberTaken`, not a generic failure.
   *
   * This test asserted `RepositoryFailure` and was **stale**: the repository
   * learned to recognise `cases_number_key` when intake gained its retry, and
   * the more specific error is the whole point of that work — `CaseService`
   * catches this tag to compute the next free reference. Its docstring also
   * described a court/rank constraint the body never exercised, which is how
   * the drift went unnoticed.
   */
  it("names a duplicate matter number rather than failing generically", async () => {
    const exit = await run(
      Effect.flatMap(CaseRepository, (repo) =>
        repo.save(matter(5, { number: matter(1).number })),
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    const error = Exit.isFailure(exit)
      ? (exit.cause as { error?: { _tag?: string } }).error
      : undefined;
    expect(error?._tag).toBe("CaseNumberTaken");
  });

  /**
   * And a constraint the repository does *not* single out still arrives as a
   * `RepositoryFailure` rather than a raw driver error — which is what the test
   * above was originally for, and is worth keeping separately.
   *
   * `filed_after_opened` is the one used: a matter filed before it was opened.
   * The domain does not model that relationship, so nothing catches it earlier
   * and the database is genuinely the last word.
   */
  it("surfaces an unrecognised constraint violation as a RepositoryFailure", async () => {
    const exit = await run(
      Effect.flatMap(CaseRepository, (repo) =>
        repo.save(
          matter(6, {
            filedOn: new Date("2020-01-01T00:00:00.000Z"),
            causeNumber: "HCCC E900 of 2020",
          }),
        ),
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    const error = Exit.isFailure(exit)
      ? (exit.cause as { error?: { _tag?: string } }).error
      : undefined;
    expect(error?._tag).toBe("RepositoryFailure");
  });
});
