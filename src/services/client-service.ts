import { Effect } from "effect";
import * as Matter from "../domain/case/case";
import * as ClientDomain from "../domain/client/client";
import type { NotPermitted } from "../domain/identity/permissions";
import type { ClientId } from "../domain/shared/ids";
import { type CurrentUser, permitted, scope, withinScope } from "./policy";
import {
  CaseRepository,
  ClientRepository,
  type NotFound,
  type RepositoryFailure,
} from "./repositories";

/**
 * Clients, as the application uses them.
 *
 * Deliberately read-only. Intake, contacts and conflict screening are Phase 7's
 * to build, and the endpoints in `api/` offer exactly what this offers — a
 * write path here that nothing calls would be a claim the app does not honour.
 *
 * It exists at all, rather than the API handlers reading `ClientRepository`
 * directly, because both operations below span two repositories. Letting a
 * delivery adapter do that join would put application logic in the transport,
 * which is precisely the arrangement `CaseService` was built to avoid — and it
 * would have to be written a second time the moment a Server Component wants
 * the same screen.
 */

/** A client, and how much of the firm's work is theirs. */
export interface ClientSummary {
  readonly client: ClientDomain.Client;
  /** Who gives instructions: the individual, or the corporate contact. */
  readonly primaryContact: string;
  readonly openMatters: number;
  readonly totalMatters: number;
}

/** A client and the matters on their file. */
export interface ClientFile {
  readonly client: ClientDomain.Client;
  readonly primaryContact: string;
  readonly matters: readonly Matter.Case[];
}

export class ClientService extends Effect.Service<ClientService>()(
  "ClientService",
  {
    effect: Effect.gen(function* () {
      const clients = yield* ClientRepository;
      const cases = yield* CaseRepository;

      return {
        /**
         * The client list, with each client's caseload counted.
         *
         * Two reads and an in-memory group, on the same reasoning as
         * `CaseService.caseload`: a repository that returned clients-with-counts
         * would be returning something that is not a `Client`, and the boundary
         * this architecture rests on is that repositories deal in domain values.
         *
         * The alternative — one `forClient` call per client — is the N+1 that
         * looks harmless at eight clients and is not at eight hundred.
         */
        directory: (): Effect.Effect<
          readonly ClientSummary[],
          NotPermitted | NotFound | RepositoryFailure,
          CurrentUser
        > =>
          Effect.gen(function* () {
            yield* permitted("client:read");
            const visible = yield* scope;

            /**
             * A portal user's "directory" is one row: themselves.
             *
             * Answering with a list rather than refusing outright is what lets
             * the portal reuse this operation, and it is safe because the list
             * is built by scoped queries rather than filtered afterwards. The
             * alternative — a second, nearly identical `myDetails` operation —
             * is a second place for the rule to be got right.
             */
            const [everyClient, everyMatter] = yield* Effect.all(
              visible._tag === "WholeFirm"
                ? [clients.all(), cases.all()]
                : [
                    Effect.map(clients.byId(visible.clientId), (client) => [
                      client,
                    ]),
                    cases.forClient(visible.clientId),
                  ],
              { concurrency: "unbounded" },
            );

            return everyClient
              .map((client): ClientSummary => {
                const theirs = everyMatter.filter(
                  (matter) => matter.clientId === client.id,
                );

                return {
                  client,
                  primaryContact: ClientDomain.primaryContact(client),
                  openMatters: theirs.filter(Matter.isOpen).length,
                  totalMatters: theirs.length,
                };
              })
              .sort((a, b) => a.client.name.localeCompare(b.client.name));
          }),

        /** One client, with their matters. */
        file: (
          id: ClientId,
        ): Effect.Effect<
          ClientFile,
          NotPermitted | NotFound | RepositoryFailure,
          CurrentUser
        > =>
          Effect.gen(function* () {
            yield* permitted("client:read");
            /**
             * Checked before the read rather than after it. For a client the
             * scope *is* the id, so there is nothing to learn from the row
             * first — and refusing early means another client's record is
             * never loaded into a process that might log it.
             */
            yield* withinScope("client", id, id);

            const client = yield* clients.byId(id);
            const matters = yield* cases.forClient(id);

            return {
              client,
              primaryContact: ClientDomain.primaryContact(client),
              matters,
            };
          }),
      };
    }),
  },
) {}
