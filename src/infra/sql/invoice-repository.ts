import { SqlClient } from "@effect/sql";
import { Effect, Layer, Option, Schema } from "effect";
import * as Billing from "../../domain/billing/invoice";
import type { ClientId, InvoiceId } from "../../domain/shared/ids";
import * as Money from "../../domain/shared/money";
import * as Ledger from "../../domain/trust/ledger";
import {
  InvoiceNumberTaken,
  InvoiceRepository,
  NotFound,
  type RepositoryFailure,
} from "../../services/repositories";
import { failure, isUniqueViolation } from "./failure";
import { InvoiceFromRow, paymentRow } from "./invoice-model";
import { isRule10Violation } from "./rule10";

/**
 * Invoices, in Postgres — an aggregate across three tables.
 *
 * `settleFromTrust` at the bottom is the reason this file is more interesting
 * than the other repositories: it is the one operation in the system where two
 * rows in different tables are only meaningful together, and where the database
 * can legitimately refuse the second after accepting the first.
 */

type RawRow = Readonly<Record<string, unknown>>;

const byParent = (rows: readonly RawRow[], key: string) => {
  const grouped = new Map<string, RawRow[]>();
  for (const row of rows) {
    const parent = String(row[key]);
    const existing = grouped.get(parent);
    if (existing === undefined) grouped.set(parent, [row]);
    else existing.push(row);
  }
  return grouped;
};

export const InvoiceRepositoryLive = Layer.effect(
  InvoiceRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const decode = Schema.decodeUnknown(InvoiceFromRow);

    /**
     * Lines and payments for a set of invoices, in one round trip each.
     *
     * `ORDER BY ordinal` on both: an invoice is a document, and its lines
     * appearing in a different order on each render is not a defensible fee
     * note. Payments are ordered for the same reason a log is.
     */
    const partsFor = (invoiceIds: readonly string[]) =>
      invoiceIds.length === 0
        ? Effect.succeed({
            lines: [] as readonly RawRow[],
            payments: [] as readonly RawRow[],
          })
        : Effect.all({
            lines: sql<RawRow>`
              SELECT * FROM invoice_lines
               WHERE invoice_id IN ${sql.in(invoiceIds)}
               ORDER BY invoice_id, ordinal
            `,
            payments: sql<RawRow>`
              SELECT * FROM payments
               WHERE invoice_id IN ${sql.in(invoiceIds)}
               ORDER BY invoice_id, ordinal
            `,
          });

    const assemble = (rows: readonly RawRow[]) =>
      partsFor(rows.map((row) => String(row["id"]))).pipe(
        Effect.flatMap(({ lines, payments }) => {
          const linesBy = byParent(lines, "invoiceId");
          const paymentsBy = byParent(payments, "invoiceId");

          return Effect.forEach(rows, (invoice) =>
            decode({
              invoice,
              lines: linesBy.get(String(invoice["id"])) ?? [],
              payments: paymentsBy.get(String(invoice["id"])) ?? [],
            }),
          );
        }),
      );

    const findById = (id: InvoiceId) =>
      sql<RawRow>`SELECT * FROM invoices WHERE id = ${id}`.pipe(
        Effect.flatMap(assemble),
        Effect.map((invoices) => Option.fromNullable(invoices[0])),
        Effect.mapError(failure("findById")),
      );

    /**
     * The trigger's refusal, turned back into the domain's own error.
     *
     * The balance is read *after* the failure, never before it: reading first
     * and deciding here would reintroduce the race the trigger's `FOR UPDATE`
     * exists to close. Postgres stays the arbiter; this only asks what the
     * balance was so the error can say something useful.
     */
    const asUnderfunded = (movement: Ledger.TrustMovement) =>
      sql<{ balanceCents: string | null }>`
        SELECT balance_cents FROM client_trust_balances
         WHERE client_id = ${movement.clientId}
      `.pipe(
        Effect.mapError(failure("settleFromTrust")),
        Effect.flatMap((rows) =>
          Effect.fail(
            new Ledger.TrustAccountUnderfunded({
              clientId: movement.clientId,
              held: Money.fromCents(Number(rows[0]?.balanceCents ?? 0)),
              requested: movement.amount,
            }),
          ),
        ),
      );

    return InvoiceRepository.of({
      byId: (id) =>
        findById(id).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(new NotFound({ entity: "Invoice", id })),
              onSome: Effect.succeed<Billing.Invoice>,
            }),
          ),
        ),

      forClient: (clientId: ClientId) =>
        sql<RawRow>`
          SELECT * FROM invoices WHERE client_id = ${clientId} ORDER BY number
        `.pipe(Effect.flatMap(assemble), Effect.mapError(failure("forClient"))),

      all: () =>
        sql<RawRow>`SELECT * FROM invoices ORDER BY number`.pipe(
          Effect.flatMap(assemble),
          Effect.mapError(failure("all")),
        ),

      /**
       * Upsert the invoice and replace its lines and payments, atomically.
       *
       * Replace rather than diff, as with a client's contacts: neither a line
       * nor a payment has an identity in the domain, so there is no key to
       * match an incoming one against.
       */
      save: (invoice) =>
        Schema.encode(InvoiceFromRow)(invoice).pipe(
          Effect.flatMap(({ invoice: row, lines, payments }) =>
            sql.withTransaction(
              Effect.gen(function* () {
                yield* sql`
                  INSERT INTO invoices ${sql.insert(row)}
                  ON CONFLICT (id) DO UPDATE SET ${sql.update(row, ["id"])}
                `;

                yield* sql`DELETE FROM invoice_lines WHERE invoice_id = ${row.id}`;
                yield* sql`DELETE FROM payments WHERE invoice_id = ${row.id}`;

                const numbered = yield* Effect.sync(() => ({
                  lines: lines.map((line, ordinal) => ({
                    id: crypto.randomUUID(),
                    invoiceId: row.id,
                    ordinal,
                    ...line,
                  })),
                  payments: payments.map((payment, ordinal) => ({
                    id: crypto.randomUUID(),
                    invoiceId: row.id,
                    ordinal,
                    ...payment,
                  })),
                }));

                if (numbered.lines.length > 0) {
                  yield* sql`INSERT INTO invoice_lines ${sql.insert(numbered.lines)}`;
                }
                if (numbered.payments.length > 0) {
                  yield* sql`INSERT INTO payments ${sql.insert(numbered.payments)}`;
                }
              }),
            ),
          ),
          Effect.as(invoice),
          Effect.catchAll(
            (
              error,
            ): Effect.Effect<never, InvoiceNumberTaken | RepositoryFailure> =>
              isUniqueViolation(error, "invoices_number_key")
                ? Effect.fail(
                    new InvoiceNumberTaken({ number: invoice.number }),
                  )
                : Effect.fail(failure("save")(error)),
          ),
        ) satisfies Effect.Effect<
          Billing.Invoice,
          InvoiceNumberTaken | RepositoryFailure
        >,

      /**
       * One payment, appended.
       *
       * The ordinal is computed inside the transaction for the same reason
       * `settleFromTrust` computes it there: `payments_ordinal_unique` is the
       * backstop, and reading the maximum outside the transaction that inserts
       * against it is a race with itself.
       *
       * The invoice is checked first so that a payment against a fee note that
       * does not exist is `NotFound` rather than a foreign-key violation
       * reported as a repository failure. A caller can do something with the
       * first and nothing with the second.
       */
      recordPayment: (invoiceId, payment) =>
        sql
          .withTransaction(
            Effect.gen(function* () {
              const invoice = yield* sql<{ readonly id: string }>`
                SELECT id FROM invoices WHERE id = ${invoiceId}
              `;

              if (invoice.length === 0) {
                return yield* Effect.fail(
                  new NotFound({ entity: "Invoice", id: invoiceId }),
                );
              }

              const next = yield* sql<{ readonly nextOrdinal: string }>`
                SELECT coalesce(max(ordinal), -1) + 1 AS next_ordinal
                  FROM payments WHERE invoice_id = ${invoiceId}
              `;

              yield* sql`
                INSERT INTO payments ${sql.insert({
                  id: crypto.randomUUID(),
                  invoiceId,
                  ordinal: Number(next[0]?.nextOrdinal ?? 0),
                  ...paymentRow(payment),
                })}
              `;
            }),
          )
          .pipe(
            /**
             * The partial unique index's refusal, as the domain's own error.
             *
             * Identical in shape to the Rule 10 translation above: Postgres is
             * the arbiter because the check and the write have to be one
             * operation, and the repository's job is to recognise *which*
             * refusal it was. Matching the index by name rather than on
             * SQLSTATE alone matters here — `payments` will grow a second
             * unique index eventually, and a translation that ignored which
             * one fired would then report a duplicate confirmation for
             * something else entirely.
             */
            Effect.catchTag(
              "SqlError",
              (
                error,
              ): Effect.Effect<
                never,
                Billing.PaymentAlreadyRecorded | RepositoryFailure
              > => {
                const confirmation = Billing.confirmationOf(payment);
                return isUniqueViolation(
                  error,
                  "payments_mpesa_confirmation",
                ) && confirmation !== undefined
                  ? Effect.fail(
                      new Billing.PaymentAlreadyRecorded({ confirmation }),
                    )
                  : Effect.fail(failure("recordPayment")(error));
              },
            ),
            Effect.asVoid,
          ),

      /**
       * The one operation that genuinely needs a transaction.
       *
       * The trust movement is written **last**, deliberately. It is the write
       * the database can refuse — Rule 10 is enforced by a trigger — so putting
       * it after the payment means the rollback path is the one that actually
       * gets exercised: a client without the balance to cover the fee leaves
       * neither row behind, not a payment row with nothing funding it.
       */
      settleFromTrust: ({ invoiceId, payment, movement }) =>
        sql
          .withTransaction(
            Effect.gen(function* () {
              const invoice = yield* sql<{ readonly id: string }>`
                SELECT id FROM invoices WHERE id = ${invoiceId}
              `;

              if (invoice.length === 0) {
                // Fails the transaction, which is what we want: nothing has
                // been written, and the rollback costs nothing.
                return yield* Effect.fail(
                  new NotFound({ entity: "Invoice", id: invoiceId }),
                );
              }

              // Inside the transaction, so the read and the insert that
              // depends on it cannot be interleaved with another settlement.
              // The `payments_ordinal_unique` constraint is the backstop.
              const next = yield* sql<{ readonly nextOrdinal: string }>`
                SELECT coalesce(max(ordinal), -1) + 1 AS next_ordinal
                  FROM payments WHERE invoice_id = ${invoiceId}
              `;

              yield* sql`
                INSERT INTO payments ${sql.insert({
                  id: crypto.randomUUID(),
                  invoiceId,
                  ordinal: Number(next[0]?.nextOrdinal ?? 0),
                  ...paymentRow(payment),
                })}
              `;

              yield* sql`
                INSERT INTO trust_movements ${sql.insert({
                  id: movement.id,
                  clientId: movement.clientId,
                  reason: movement.reason,
                  amountCents: movement.amount,
                  recordedAt: movement.recordedAt,
                  reference: movement.reference ?? null,
                })}
              `;
            }),
          )
          .pipe(
            // `NotFound` passes through untouched; only a database refusal is
            // a candidate for the Rule 10 translation.
            Effect.catchTag("SqlError", (error) =>
              isRule10Violation(error)
                ? asUnderfunded(movement)
                : Effect.fail(failure("settleFromTrust")(error)),
            ),
          ),
    });
  }),
);
