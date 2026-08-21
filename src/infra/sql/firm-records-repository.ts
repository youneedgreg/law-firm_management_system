import { SqlClient, SqlSchema } from "@effect/sql";
import { Effect, Layer, Schema } from "effect";
import type * as Log from "../../domain/firm/contact";
import type * as Library from "../../domain/firm/precedent";
import { ClientId } from "../../domain/shared/ids";
import {
  ContactRepository,
  PrecedentRepository,
  type RepositoryFailure,
} from "../../services/repositories";
import { reading, writing } from "./resilience";
import {
  ContactFromRow,
  contactRow,
  PrecedentFromRow,
  precedentRow,
} from "./firm-records-model";

/**
 * The contact log, in Postgres.
 *
 * `latestPerClient` answers "when did we last speak to each client" in one
 * `DISTINCT ON` rather than a query per client. The alternative is the shape
 * that looks fine against six seeded clients and is forty round trips against a
 * real firm's list — the same reasoning as `MessageRepository.unanswered`.
 */
export const ContactRepositoryLive = Layer.effect(
  ContactRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const forClient = SqlSchema.findAll({
      Request: ClientId,
      Result: ContactFromRow,
      execute: (clientId) =>
        sql`SELECT * FROM contacts WHERE client_id = ${clientId} ORDER BY occurred_on DESC`,
    });

    const recent = SqlSchema.findAll({
      Request: Schema.Int,
      Result: ContactFromRow,
      execute: (limit) =>
        sql`SELECT * FROM contacts ORDER BY occurred_on DESC, logged_at DESC LIMIT ${limit}`,
    });

    const latestPerClient = SqlSchema.findAll({
      Request: Schema.Void,
      Result: ContactFromRow,
      execute: () => sql`
        SELECT DISTINCT ON (client_id) *
          FROM contacts
         ORDER BY client_id, occurred_on DESC, logged_at DESC
      `,
    });

    return ContactRepository.of({
      forClient: (clientId) =>
        forClient(clientId).pipe(reading("ContactRepository.forClient")),

      recent: (limit) =>
        recent(limit).pipe(reading("ContactRepository.recent")),

      latestPerClient: () =>
        latestPerClient().pipe(reading("ContactRepository.latestPerClient")),

      log: (contact) =>
        Effect.sync(() => contactRow(contact)).pipe(
          Effect.flatMap((row) => sql`INSERT INTO contacts ${sql.insert(row)}`),
          Effect.as(contact),
          writing("ContactRepository.log"),
        ) satisfies Effect.Effect<Log.Contact, RepositoryFailure>,
    });
  }),
);

/**
 * The precedent bank, in Postgres.
 *
 * `all()` and nothing else, and that is deliberate. A firm's bank is tens of
 * entries; search and the staleness check both run over the whole list in the
 * domain, where the rules are written and tested. Pushing them into SQL would
 * put "is this still good law" in two places — a `WHERE reviewed_on <` here and
 * `isStale` there — and the two would eventually disagree about the interval.
 *
 * The *global* search in the next slice is a different problem: it spans
 * thousands of rows across five tables, and that one belongs in the database.
 */
export const PrecedentRepositoryLive = Layer.effect(
  PrecedentRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const all = SqlSchema.findAll({
      Request: Schema.Void,
      Result: PrecedentFromRow,
      execute: () => sql`SELECT * FROM precedents ORDER BY title`,
    });

    return PrecedentRepository.of({
      all: () => all().pipe(reading("PrecedentRepository.all")),

      save: (precedent) =>
        Effect.sync(() => precedentRow(precedent)).pipe(
          Effect.flatMap(
            (row) => sql`
              INSERT INTO precedents ${sql.insert(row)}
              ON CONFLICT (id) DO UPDATE SET ${sql.update(row, ["id"])}
            `,
          ),
          Effect.as(precedent),
          writing("PrecedentRepository.save"),
        ) satisfies Effect.Effect<Library.Precedent, RepositoryFailure>,
    });
  }),
);
