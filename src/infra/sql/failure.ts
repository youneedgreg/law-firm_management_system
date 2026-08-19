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

/**
 * Recognising a unique-index refusal, and which index refused.
 *
 * The driver's error carries SQLSTATE `23505` and the constraint name, but
 * both sit on the `cause` — `@effect/sql` wraps the original — and neither is
 * typed, since `SqlError.cause` is `unknown`. Reading them through a guard
 * keeps that narrowing in one place rather than in every repository that has
 * a uniqueness rule worth translating.
 *
 * Matching the constraint name and not just the code is the point. A table
 * with two unique indexes refuses for two different reasons, and a translation
 * that ignored which one would report the wrong thing exactly when a second
 * index is added.
 */
export const isUniqueViolation = (
  error: QueryFailure,
  constraint: string,
): boolean => {
  const cause: unknown = "cause" in error ? error.cause : undefined;
  if (typeof cause !== "object" || cause === null) return false;

  const detail = cause as { code?: unknown; constraint?: unknown };
  return detail.code === "23505" && detail.constraint === constraint;
};
