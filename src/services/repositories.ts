import { Context, Effect, Option, Schema } from "effect";
import type * as Matter from "../domain/case/case";
import type * as Client from "../domain/client/client";
import type * as Ledger from "../domain/trust/ledger";
import type { CaseId, ClientId } from "../domain/shared/ids";
import type * as Money from "../domain/shared/money";

/**
 * Repository interfaces.
 *
 * These live in `services/` and are declared here rather than in `infra/`,
 * which is the whole point of the arrangement: a service depends on the
 * *interface it needs*, and `infra/` supplies an implementation. Nothing in
 * this file knows that Postgres exists, so a test can hand a service an
 * in-memory array and the service cannot tell.
 *
 * The ESLint boundary rules make that structural rather than aspirational —
 * `services/**` cannot import `@/infra/*` at all.
 */

/** Something was looked up by id and was not there. */
export class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
  entity: Schema.String,
  id: Schema.String,
}) {
  get reason(): string {
    return `No ${this.entity} with id ${this.id}`;
  }
}

/** The database refused or failed. Carries the cause without leaking SQL. */
export class RepositoryFailure extends Schema.TaggedError<RepositoryFailure>()(
  "RepositoryFailure",
  { operation: Schema.String, detail: Schema.String },
) {
  get reason(): string {
    return `${this.operation} failed: ${this.detail}`;
  }
}

export interface CaseRepository {
  readonly byId: (
    id: CaseId,
  ) => Effect.Effect<Matter.Case, NotFound | RepositoryFailure>;

  readonly findById: (
    id: CaseId,
  ) => Effect.Effect<Option.Option<Matter.Case>, RepositoryFailure>;

  readonly forClient: (
    clientId: ClientId,
  ) => Effect.Effect<readonly Matter.Case[], RepositoryFailure>;

  readonly openMatters: () => Effect.Effect<
    readonly Matter.Case[],
    RepositoryFailure
  >;

  readonly save: (
    matter: Matter.Case,
  ) => Effect.Effect<Matter.Case, RepositoryFailure>;
}

export const CaseRepository =
  Context.GenericTag<CaseRepository>("CaseRepository");

export interface ClientRepository {
  readonly byId: (
    id: ClientId,
  ) => Effect.Effect<Client.Client, NotFound | RepositoryFailure>;

  readonly all: () => Effect.Effect<
    readonly Client.Client[],
    RepositoryFailure
  >;

  readonly save: (
    client: Client.Client,
  ) => Effect.Effect<Client.Client, RepositoryFailure>;
}

export const ClientRepository =
  Context.GenericTag<ClientRepository>("ClientRepository");

/**
 * The trust ledger.
 *
 * `recordWithdrawal` returns the domain's own `TrustAccountUnderfunded` in its
 * error channel, not a generic database failure. The database enforces Rule 10
 * with a trigger, so a refusal arrives as a Postgres error — the Postgres
 * implementation's job is to recognise that specific refusal and translate it
 * back into the domain error, so callers handle one shape whichever layer
 * caught it.
 */
export interface TrustRepository {
  readonly balanceFor: (
    clientId: ClientId,
  ) => Effect.Effect<Money.Money, RepositoryFailure>;

  readonly movementsFor: (
    clientId: ClientId,
  ) => Effect.Effect<readonly Ledger.TrustMovement[], RepositoryFailure>;

  readonly recordDeposit: (
    movement: Ledger.TrustMovement,
  ) => Effect.Effect<Ledger.TrustMovement, RepositoryFailure>;

  readonly recordWithdrawal: (
    movement: Ledger.TrustMovement,
  ) => Effect.Effect<
    Ledger.TrustMovement,
    Ledger.TrustAccountUnderfunded | RepositoryFailure
  >;

  /** Every client currently overdrawn. Should always be empty. */
  readonly overdrawn: () => Effect.Effect<
    readonly ClientId[],
    RepositoryFailure
  >;
}

export const TrustRepository =
  Context.GenericTag<TrustRepository>("TrustRepository");
