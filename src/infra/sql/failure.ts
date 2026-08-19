import type { SqlError } from "@effect/sql";
import type { ParseResult } from "effect";
import { RepositoryFailure } from "../../services/repositories";

/**
 * The two ways a query can go wrong, and the one error a caller sees.
 *
 * A `SqlError` is the database refusing or being unreachable. A `ParseError` is
 * something subtler and worth naming: the query succeeded, and the rows it
 * returned do not satisfy the domain. That is not a bug in the caller and not a
 * transient fault — it is stored data the model says cannot exist, which is
 * exactly the signal a repository should be surfacing rather than coercing
 * away.
 *
 * Both become `RepositoryFailure`, because the distinction is not one a service
 * can act on differently. What a service *can* act on — a Rule 10 breach, a row
 * that is not there — is translated into a domain error before it gets here.
 */
export type QueryFailure = SqlError.SqlError | ParseResult.ParseError;

/**
 * Only the message is carried over. A driver error can hold the query it
 * failed on, and the query can hold values that should not reach a log.
 */
export const failure = (operation: string) => (error: QueryFailure) =>
  new RepositoryFailure({ operation, detail: error.message });
