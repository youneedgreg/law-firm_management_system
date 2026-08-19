import { DateTime, Effect } from "effect";
import * as Billing from "../domain/billing/invoice";
import type * as Money from "../domain/shared/money";
import type { ClientId, InvoiceId } from "../domain/shared/ids";
import {
  ClientRepository,
  InvoiceRepository,
  type NotFound,
  type RepositoryFailure,
} from "./repositories";

/**
 * Fee notes, as the application uses them.
 *
 * The domain stores neither an invoice's total nor its status — both are
 * functions of the lines, the payments and the date, and Phase 1 refused to
 * persist anything derivable. That decision has a consequence at this boundary:
 * `status` needs to know what day it is, and the domain will not read a clock,
 * so *somebody* has to supply one. This layer is that somebody.
 *
 * Doing it here rather than in the caller is the whole point. An invoice is
 * "Overdue" relative to a moment, and if each screen and each API consumer
 * picked its own moment they would disagree — the list would show Overdue and
 * the detail page Unpaid, for the same row, in the same second. One read of the
 * clock per request, applied to every invoice in it, and they cannot.
 *
 * Read-only, deliberately. Recording payments and raising fee notes is Phase 7,
 * and `InvoiceRepository.settleFromTrust` — the interesting write — is already
 * built and waiting for the use-case that calls it.
 */

/** An invoice with the figures a screen would otherwise recompute. */
export interface InvoiceView {
  readonly invoice: Billing.Invoice;
  readonly total: Money.Money;
  readonly paid: Money.Money;
  readonly outstanding: Money.Money;
  readonly status: Billing.InvoiceStatus;
  /** Whole days past due, or 0. */
  readonly daysOverdue: number;
}

export class BillingService extends Effect.Service<BillingService>()(
  "BillingService",
  {
    effect: Effect.gen(function* () {
      const invoices = yield* InvoiceRepository;
      const clients = yield* ClientRepository;

      const view = (invoice: Billing.Invoice, asAt: Date): InvoiceView => ({
        invoice,
        total: Billing.total(invoice),
        paid: Billing.paid(invoice),
        outstanding: Billing.outstanding(invoice),
        status: Billing.status(invoice, asAt),
        daysOverdue: Billing.daysOverdue(invoice, asAt),
      });

      return {
        /** One fee note, with its derived figures. */
        invoice: (
          id: InvoiceId,
        ): Effect.Effect<InvoiceView, NotFound | RepositoryFailure> =>
          Effect.gen(function* () {
            const [invoice, asAt] = yield* Effect.all([
              invoices.byId(id),
              DateTime.nowAsDate,
            ]);
            return view(invoice, asAt);
          }),

        /**
         * Every fee note raised against one client.
         *
         * The client is looked up first so that an unknown id fails as
         * `NotFound` rather than succeeding with an empty list. "This client has
         * no invoices" and "there is no such client" are different answers, and
         * a caller that cannot tell them apart will show the wrong one.
         */
        forClient: (
          clientId: ClientId,
        ): Effect.Effect<
          readonly InvoiceView[],
          NotFound | RepositoryFailure
        > =>
          Effect.gen(function* () {
            yield* clients.byId(clientId);

            const [raised, asAt] = yield* Effect.all([
              invoices.forClient(clientId),
              DateTime.nowAsDate,
            ]);

            // One clock reading for the whole list, so two invoices in the same
            // response cannot be judged against two different "now"s.
            return raised
              .map((invoice) => view(invoice, asAt))
              .sort(
                (a, b) =>
                  b.invoice.issuedOn.getTime() - a.invoice.issuedOn.getTime(),
              );
          }),
      };
    }),
  },
) {}
