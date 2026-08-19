import { Effect, Layer, Option, Ref } from "effect";
import type * as Matter from "@/domain/case/case";
import type * as Client from "@/domain/client/client";
import type * as Firm from "@/domain/firm/advocate";
import type { CaseId, ClientId } from "@/domain/shared/ids";
import {
  AdvocateRepository,
  CaseNumberTaken,
  CaseRepository,
  ClientRepository,
  NotFound,
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

export const inMemoryCases = (
  seed: readonly Matter.Case[] = [],
): Layer.Layer<CaseRepository> =>
  Layer.effect(
    CaseRepository,
    Effect.gen(function* () {
      const store = yield* Ref.make(seed);

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
    }),
  );

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
