import { SqlClient, SqlSchema } from "@effect/sql";
import { Effect, Layer, Schema } from "effect";
import type * as Correspondence from "../../domain/message/message";
import { ClientId } from "../../domain/shared/ids";
import {
  MessageRepository,
  type RepositoryFailure,
} from "../../services/repositories";
import { failure } from "./failure";
import { MessageFromRow, messageRow } from "./message-model";

/**
 * Correspondence, in Postgres.
 *
 * ## `unanswered` is one query, and it has to be
 *
 * "Which clients are waiting on us" could be answered by reading every message
 * and folding in memory. It is a `DISTINCT ON` instead, because the fold would
 * pull the firm's entire correspondence history into the application to produce
 * a list of six rows — and would keep doing so, growing, on a screen somebody
 * looks at every morning.
 *
 * The shape is: the latest message per client, kept only when it is from the
 * client. If the newest thing in a thread is from the firm, that client is not
 * waiting. Then, for each client still waiting, the *earliest* message in that
 * unbroken run — because the honest answer to "how long have they waited" is
 * when they first asked, not when they last chased.
 */
export const MessageRepositoryLive = Layer.effect(
  MessageRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const forClient = SqlSchema.findAll({
      Request: ClientId,
      Result: MessageFromRow,
      execute: (clientId) =>
        sql`SELECT * FROM messages WHERE client_id = ${clientId} ORDER BY sent_at`,
    });

    const unanswered = SqlSchema.findAll({
      Request: Schema.Void,
      Result: MessageFromRow,
      execute: () => sql`
        WITH latest AS (
          SELECT DISTINCT ON (client_id) *
            FROM messages
           ORDER BY client_id, sent_at DESC
        ),
        waiting AS (
          SELECT client_id FROM latest WHERE author = 'FromClient'
        ),
        -- The last time the firm said anything, per waiting client. Null when
        -- the firm has never replied at all, which the COALESCE handles.
        replied AS (
          SELECT client_id, max(sent_at) AS at
            FROM messages
           WHERE author = 'FromFirm'
           GROUP BY client_id
        )
        SELECT DISTINCT ON (m.client_id) m.*
          FROM messages m
          JOIN waiting w ON w.client_id = m.client_id
          LEFT JOIN replied r ON r.client_id = m.client_id
         WHERE m.author = 'FromClient'
           AND m.sent_at > COALESCE(r.at, '-infinity'::timestamptz)
         ORDER BY m.client_id, m.sent_at ASC
      `,
    });

    return MessageRepository.of({
      forClient: (clientId) =>
        forClient(clientId).pipe(Effect.mapError(failure("forClient"))),

      unanswered: () =>
        unanswered().pipe(
          Effect.map((rows) =>
            [...rows].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime()),
          ),
          Effect.mapError(failure("unanswered")),
        ),

      send: (message) =>
        Effect.sync(() => messageRow(message)).pipe(
          Effect.flatMap((row) => sql`INSERT INTO messages ${sql.insert(row)}`),
          Effect.as(message),
          Effect.mapError(failure("send")),
        ) satisfies Effect.Effect<Correspondence.Message, RepositoryFailure>,

      markRead: (ids, at) =>
        ids.length === 0
          ? Effect.succeed(0)
          : sql`
              UPDATE messages
                 SET read_at = ${at}
               WHERE id IN ${sql.in(ids)}
                 AND read_at IS NULL
              RETURNING id
            `.pipe(
              /**
               * `AND read_at IS NULL` is not an optimisation — it is what
               * makes this safe to call on a whole thread. The append-only
               * trigger refuses a *second, different* read time, so an update
               * that touched already-read rows would fail the entire
               * statement and leave nothing marked.
               */
              Effect.map((rows) => rows.length),
              Effect.mapError(failure("markRead")),
            ),
    });
  }),
);
