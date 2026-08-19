import { SqlClient } from "@effect/sql";
import { Effect, Layer, Option, Schema } from "effect";
import type * as Client from "../../domain/client/client";
import type { ClientId } from "../../domain/shared/ids";
import {
  ClientRepository,
  NotFound,
  type RepositoryFailure,
} from "../../services/repositories";
import { ClientFromRow } from "./client-model";
import { failure } from "./failure";

/**
 * Clients, in Postgres — a client and its contacts, across two tables.
 *
 * Reads are two queries and a group, not a join. A join repeats the client row
 * once per contact and cannot distinguish "a client with no contacts" from "no
 * such client", which is precisely the case the domain cares about: a corporate
 * client with nobody able to instruct the firm is an integrity failure, and
 * `ClientFromRow` refuses it. Two queries keep that refusal reachable.
 */

/** A row as the driver hands it over, before the model has looked at it. */
type RawRow = Readonly<Record<string, unknown>>;

/**
 * Attaches each contact to its client.
 *
 * Grouping in memory rather than issuing a query per client: the alternative is
 * an N+1, and the contact table is small enough that fetching the relevant
 * slice in one round trip is strictly better.
 */
const group = (clients: readonly RawRow[], contacts: readonly RawRow[]) => {
  const byClient = new Map<string, RawRow[]>();

  for (const contact of contacts) {
    const key = String(contact["clientId"]);
    const existing = byClient.get(key);
    if (existing === undefined) byClient.set(key, [contact]);
    else existing.push(contact);
  }

  return clients.map((client) => ({
    client,
    contacts: byClient.get(String(client["id"])) ?? [],
  }));
};

export const ClientRepositoryLive = Layer.effect(
  ClientRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const decode = Schema.decodeUnknown(ClientFromRow);

    /** `ORDER BY ordinal` is what makes `contacts[0]` mean anything. */
    const contactsFor = (clientIds: readonly string[]) =>
      clientIds.length === 0
        ? Effect.succeed([] as readonly RawRow[])
        : sql<RawRow>`
            SELECT * FROM client_contacts
             WHERE client_id IN ${sql.in(clientIds)}
             ORDER BY client_id, ordinal
          `;

    const assemble = (rows: readonly RawRow[]) =>
      contactsFor(rows.map((row) => String(row["id"]))).pipe(
        Effect.flatMap((contacts) =>
          // Wrapped rather than passed by reference: `decode`'s second
          // parameter is `ParseOptions`, and `forEach` would hand it an index.
          Effect.forEach(group(rows, contacts), (row) => decode(row)),
        ),
      );

    const all = () =>
      sql<RawRow>`SELECT * FROM clients ORDER BY number`.pipe(
        Effect.flatMap(assemble),
        Effect.mapError(failure("all")),
      );

    const findById = (id: ClientId) =>
      sql<RawRow>`SELECT * FROM clients WHERE id = ${id}`.pipe(
        Effect.flatMap(assemble),
        Effect.map((clients) => Option.fromNullable(clients[0])),
        Effect.mapError(failure("findById")),
      );

    return ClientRepository.of({
      all,

      byId: (id) =>
        findById(id).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.fail(new NotFound({ entity: "Client", id })),
              onSome: Effect.succeed<Client.Client>,
            }),
          ),
        ),

      /**
       * Upsert the client, then replace its contacts wholesale — in one
       * transaction, because a client that briefly has no contacts is a state
       * the domain says cannot exist, and a concurrent read must never see it.
       *
       * Replace rather than diff: a contact has no identity in the domain, so
       * there is nothing to match an incoming contact against. Diffing would
       * mean inventing a key (name? role?) and getting it subtly wrong on the
       * day someone corrects a spelling.
       */
      save: (client) =>
        Schema.encode(ClientFromRow)(client).pipe(
          Effect.flatMap(({ client: row, contacts }) =>
            sql.withTransaction(
              Effect.gen(function* () {
                yield* sql`
                  INSERT INTO clients ${sql.insert(row)}
                  ON CONFLICT (id) DO UPDATE SET ${sql.update(row, ["id"])}
                `;

                yield* sql`DELETE FROM client_contacts WHERE client_id = ${row.id}`;

                if (contacts.length === 0) return;

                // Ordinals are assigned from the array, so the order the caller
                // gave is the order that comes back.
                const rows = yield* Effect.sync(() =>
                  contacts.map((contact, ordinal) => ({
                    id: crypto.randomUUID(),
                    clientId: row.id,
                    ordinal,
                    ...contact,
                  })),
                );

                yield* sql`INSERT INTO client_contacts ${sql.insert(rows)}`;
              }),
            ),
          ),
          Effect.as(client),
          Effect.mapError(failure("save")),
        ) satisfies Effect.Effect<Client.Client, RepositoryFailure>,
    });
  }),
);
