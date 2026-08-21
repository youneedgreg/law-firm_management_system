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
): boolean =>
  chain(error).some(
    (link) => link.code === "23505" && link.constraint === constraint,
  );

/**
 * The SQLSTATE and socket codes anywhere in the chain, outermost first.
 *
 * What `resilience.ts` decides retryability from. It is a list rather than a
 * single value because the driver's code and the transaction wrapper's are at
 * different depths, and which one is present depends on how the statement was
 * run — see `chain`.
 */
export const codesIn = (error: unknown): readonly string[] =>
  chain(error)
    .map((link) => link.code)
    .filter((code): code is string => typeof code === "string");

interface Link {
  readonly code?: unknown;
  readonly constraint?: unknown;
}

/**
 * The cause chain, walked rather than read one level down — and that is not
 * defensiveness, it is a bug this had.
 *
 * A statement run directly puts the driver's error on `SqlError.cause`, which
 * is what the original one-level version assumed. A statement run inside
 * `sql.withTransaction` does not: the transaction wrapper catches the inner
 * failure and raises its own `SqlError`, so the driver's error is one level
 * further down and `cause.code` is `undefined`.
 *
 * The symptom was specific and would have been very annoying to find in
 * production: `CaseRepository.save` translated its unique violation correctly
 * because it writes outside a transaction, and `InvoiceRepository.recordPayment`
 * silently did not because it writes inside one — so a duplicate M-Pesa
 * confirmation came back as "the database refused the write" instead of naming
 * the code that had already been banked. Found in the browser, on the first
 * duplicate posted.
 *
 * The depth cap is there so a cyclic `cause` cannot spin. Five is well beyond
 * anything `@effect/sql` nests.
 */
const chain = (error: unknown): readonly Link[] => {
  const links: Link[] = [];
  let current = error;

  for (let depth = 0; depth <= 5; depth++) {
    if (typeof current !== "object" || current === null) break;

    links.push(current as Link);
    if (!("cause" in current)) break;
    current = (current as { cause: unknown }).cause;
  }

  return links;
};
