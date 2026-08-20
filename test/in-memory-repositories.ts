import { Effect, Layer, Option, Ref, Schema } from "effect";
import type * as Audit from "@/domain/audit/entry";
import type * as Billing from "@/domain/billing/invoice";
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
  AuditRepository,
  CaseNumberTaken,
  CaseRepository,
  ClientRepository,
  InvoiceRepository,
  NotFound,
  SessionGateway,
  Transactor,
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
 * Invoices, backed by an array.
 *
 * `settleFromTrust` is deliberately absent from what this can honestly fake.
 * The real one is a transaction whose whole purpose is that two writes cannot
 * come apart, and whose refusal comes from the Rule 10 trigger inside Postgres.
 * A version of it over arrays would pass without exercising either property —
 * it would be a test that the fake works. It is tested where it means
 * something, in `invoice-repository.integration.test.ts`, against real
 * Postgres, so here it fails loudly rather than pretending.
 */
export const inMemoryInvoices = (
  seed: readonly Billing.Invoice[] = [],
): Layer.Layer<InvoiceRepository> =>
  Layer.effect(
    InvoiceRepository,
    Effect.gen(function* () {
      const store = yield* Ref.make(seed);

      return InvoiceRepository.of({
        byId: (id: InvoiceId) =>
          Ref.get(store).pipe(
            Effect.flatMap((rows) => {
              const found = rows.find((invoice) => invoice.id === id);
              return found === undefined
                ? notFound("Invoice", id)
                : Effect.succeed(found);
            }),
          ),

        forClient: (clientId) =>
          Ref.get(store).pipe(
            Effect.map((rows) =>
              rows.filter((invoice) => invoice.clientId === clientId),
            ),
          ),

        save: (invoice) =>
          Ref.update(store, (rows) => upsert(rows, invoice)).pipe(
            Effect.as(invoice),
          ),

        settleFromTrust: () =>
          Effect.die(
            "settleFromTrust has no in-memory equivalent: it is a transaction " +
              "arbitrated by the Rule 10 trigger. See " +
              "invoice-repository.integration.test.ts",
          ),
      });
    }),
  );

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
