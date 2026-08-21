import { Effect, Either, Schema } from "effect";
import { notFound } from "next/navigation";
import { may } from "@/domain/identity/permissions";
import { InvoiceId } from "@/domain/shared/ids";
import { runAs, signedIn } from "@/runtime/session";
import { BillingService } from "@/services/billing-service";
import { InvoiceDetail } from "./InvoiceDetail";

/**
 * One fee note, read from Postgres.
 *
 * `generateStaticParams` is gone, for the reason it went from the matter file:
 * fee notes are rows, and a build-time list of ids would 404 every invoice
 * raised after the deploy. So is `CreatedInvoice` — the browser-side store that
 * stood in for one raised in this session — because there is now one answer to
 * what the firm has billed and it is in the database.
 *
 * The id is decoded before it is used, so `/billing/invoices/nonsense` is a 404
 * rather than a query that fails: a malformed id names no fee note, which is the
 * same answer as one that names nothing.
 */
export default async function InvoiceDetailPage({
  params,
}: PageProps<"/billing/invoices/[id]">) {
  const { id } = await params;

  const invoiceId = Schema.decodeUnknownEither(InvoiceId)(id);
  if (Either.isLeft(invoiceId)) notFound();

  const principal = await signedIn();

  /**
   * `NotFound` here covers two things that are deliberately indistinguishable:
   * no such fee note, and a fee note belonging to another client. See
   * `services/policy.ts` — telling a portal user that an invoice exists but is
   * not theirs would confirm that the firm acts for whoever it was raised
   * against.
   */
  const feeNote = await runAs(
    Effect.gen(function* () {
      const billing = yield* BillingService;
      return yield* billing.feeNote(invoiceId.right);
    }).pipe(Effect.catchTag("NotFound", () => Effect.succeed(undefined))),
  );

  if (feeNote === undefined) notFound();

  return (
    <InvoiceDetail
      feeNote={feeNote}
      mayRecordPayment={may(principal, "invoice:write")}
      mayMoveMoney={may(principal, "trust:write")}
    />
  );
}
