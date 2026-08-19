import { Effect } from "effect";
import * as Matter from "../domain/case/case";
import * as ClientDomain from "../domain/client/client";
import type { ClientId } from "../domain/shared/ids";
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
          RepositoryFailure
        > =>
          Effect.gen(function* () {
            const [everyClient, everyMatter] = yield* Effect.all(
              [clients.all(), cases.all()],
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
        ): Effect.Effect<ClientFile, NotFound | RepositoryFailure> =>
          Effect.gen(function* () {
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
