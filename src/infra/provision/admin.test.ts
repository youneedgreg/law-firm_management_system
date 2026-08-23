import { Effect, Exit, Layer, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { UserId } from "../../domain/shared/ids";
import {
  AdvocateRepository,
  UserRepository,
} from "../../services/repositories";
import { grace, sarah } from "../../../test/fixtures";
import {
  inMemoryAdvocates,
  inMemoryUsers,
} from "../../../test/in-memory-repositories";
import { MINIMUM_PASSWORD, provisionAdmin } from "./admin";
import type { AdminRequest } from "./options";

/**
 * What `provisionAdmin` refuses, and that it refuses before writing (D-13).
 *
 * This program writes the first login on a firm's installation. The happy path
 * belongs to Postgres — `users_exactly_one_subject` is the constraint the whole
 * design rests on, and `inMemoryUsers.provision` deliberately dies rather than
 * pretend to enforce it, so proving the insert works means an integration test
 * against a real database.
 *
 * The *refusals* are a different matter. All three happen before either insert,
 * which makes them both the interesting half and the testable half: what
 * matters is not that a bad request fails, but that it fails having written
 * nothing.
 *
 * ## The cast is the assertion
 *
 * `provisionAdmin` also requires `Auth`, for the password hash. Narrowing the
 * requirement to the two repositories is a lie about the type and a true
 * statement about the execution: every case below stops before `setPassword`,
 * so the hasher is never asked for. If a refusal were ever moved below it,
 * these stop passing — the run would die looking for a service instead of
 * failing with a sentence.
 */

const request: AdminRequest = {
  name: "Grace Kimani",
  email: "grace.kimani@kimani-otieno.co.ke",
  role: "Managing Partner",
};

const GOOD_PASSWORD = "a-long-enough-password";

const run = (
  input: AdminRequest,
  password: string,
  layer: Layer.Layer<AdvocateRepository | UserRepository>,
) =>
  Effect.runPromiseExit(
    (
      provisionAdmin(input, password) as unknown as Effect.Effect<
        unknown,
        unknown,
        AdvocateRepository | UserRepository
      >
    ).pipe(Effect.provide(layer)),
  );

/** A staff principal for somebody who already has a login. */
const staffPrincipal = (email: string) => ({
  _tag: "Staff" as const,
  userId: Schema.decodeSync(UserId)("50000000-0000-4000-8000-000000000001"),
  advocateId: sarah.id,
  name: "Adv. Sarah Wanjiru",
  role: "Advocate" as const,
  email,
});

describe("provisioning the first login", () => {
  /**
   * Checked first, before anything is read, because it is the one refusal that
   * needs nothing from the database to decide.
   *
   * The floor is `AUTH_OPTIONS.minPasswordLength` rather than a number chosen
   * here. A provisioning script with its own, lower rule would be a way around
   * the only password rule this system has, and the account it lets in is the
   * Managing Partner's.
   */
  it("refuses a password shorter than the application's own floor", async () => {
    const short = "x".repeat(MINIMUM_PASSWORD - 1);

    const exit = await run(
      request,
      short,
      Layer.merge(inMemoryAdvocates([]), inMemoryUsers([])),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain(String(MINIMUM_PASSWORD));
    }
  });

  /**
   * `users.email` is `UNIQUE`, so Postgres would refuse this too — but it
   * would refuse it *after* the advocate row was written, leaving a member of
   * staff with no login and a half-finished operation to unpick by hand.
   */
  it("refuses an address that already has a login, writing nothing", async () => {
    const advocates = inMemoryAdvocates([]);

    const exit = await run(
      request,
      GOOD_PASSWORD,
      Layer.merge(advocates, inMemoryUsers([staffPrincipal(request.email)])),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain("already has a login");
    }

    const staff = await Effect.runPromise(
      Effect.flatMap(AdvocateRepository, (repository) => repository.all()).pipe(
        Effect.provide(advocates),
      ),
    );

    expect(staff).toHaveLength(0);
  });

  /**
   * The one nothing else would catch. `advocates.email` is deliberately *not*
   * unique — two people can share an address in principle — so running the
   * same command twice would quietly produce two staff records with one name,
   * and the login would point at the second.
   */
  it("refuses an address already on the staff list, writing nothing", async () => {
    const advocates = inMemoryAdvocates([grace]);

    const exit = await run(
      { ...request, email: grace.email },
      GOOD_PASSWORD,
      Layer.merge(advocates, inMemoryUsers([])),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain(grace.name);
    }

    const staff = await Effect.runPromise(
      Effect.flatMap(AdvocateRepository, (repository) => repository.all()).pipe(
        Effect.provide(advocates),
      ),
    );

    expect(staff).toHaveLength(1);
  });

  /**
   * Case-insensitively, because addresses are. `GRACE@` and `grace@` are one
   * mailbox, and a check that missed that would be a check that let the
   * duplicate through on the second try.
   */
  it("matches an existing address regardless of case", async () => {
    const exit = await run(
      { ...request, email: grace.email.toUpperCase() },
      GOOD_PASSWORD,
      Layer.merge(inMemoryAdvocates([grace]), inMemoryUsers([])),
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });
});
