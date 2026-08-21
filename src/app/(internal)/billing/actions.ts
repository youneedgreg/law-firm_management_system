"use server";

import { Effect, Either, ParseResult, Schema } from "effect";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { InvoiceId } from "@/domain/shared/ids";
import {
  type ActionState,
  IDLE,
  refused,
  typedValues,
} from "@/lib/action-state";
import { attemptAs } from "@/runtime/session";
import { BillingService } from "@/services/billing-service";
import {
  asDeposit,
  asPayment,
  asSettlement,
  RaiseInvoiceForm,
  ReceivePaymentForm,
  RecordDepositForm,
  SettleFromTrustForm,
  submitted,
} from "./forms";

/**
 * The write side of billing.
 *
 * Four actions, one shape: decode the submission through a schema, hand the
 * decoded value to `BillingService`, turn whatever comes back into something
 * the form can render. Nothing here decides whether a payment is allowed, what
 * the fee-note number is, or whether Rule 10 permits a withdrawal. Those are
 * the domain's, the service's and Postgres's respectively, and an action that
 * re-checked any of them would be the copy that goes stale.
 *
 * Every refusal comes back as a value. A duplicate M-Pesa confirmation and a
 * client account that cannot cover the costs are both *answers*, and the person
 * at the keyboard is the one who can do something about them.
 */

/** A parse failure, as messages against the inputs that caused it. */
const fromParseError = (
  error: ParseResult.ParseError,
  values: Readonly<Record<string, string>>,
): ActionState => {
  const issues = ParseResult.ArrayFormatter.formatErrorSync(error);
  const fields: Record<string, string> = {};

  for (const issue of issues) {
    const field = issue.path.join(".");
    if (field !== "" && fields[field] === undefined) {
      fields[field] = issue.message;
    }
  }

  const named = Object.keys(fields);
  return refused(
    named.length === 0
      ? "The form could not be read."
      : `Check ${named.length === 1 ? "this field" : "these fields"}: ${named.join(", ")}.`,
    { fields, values },
  );
};

/**
 * A service failure, as a sentence.
 *
 * Every money refusal carries a `reason` written for a finance officer — the
 * confirmation code that was already banked, the balance the firm actually
 * holds for that client and the rule that says so — so they are shown as they
 * are. `RepositoryFailure` is the exception, for the usual reason: it carries a
 * driver message that can carry the query.
 */
const explain = (error: { readonly _tag: string }): string => {
  if (error._tag === "RepositoryFailure") {
    return "The entry could not be saved. The database refused the write; the details are in the server log.";
  }

  if (error._tag === "NotFound") {
    return "That record is no longer on file. It may have been removed while this page was open.";
  }

  const reason: unknown = (error as { reason?: unknown }).reason;
  return typeof reason === "string"
    ? `${reason}.`
    : "The entry could not be saved.";
};

const invoiceId = (id: string) => Schema.decodeUnknownEither(InvoiceId)(id);

// ── Raising a fee note ────────────────────────────────────────────────────

export async function raiseInvoice(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const values = typedValues(form);
  const decoded = Schema.decodeUnknownEither(RaiseInvoiceForm)(
    submitted(form),
    {
      errors: "all",
    },
  );

  if (Either.isLeft(decoded)) return fromParseError(decoded.left, values);

  const outcome = await attemptAs(
    Effect.flatMap(BillingService, (billing) => billing.raise(decoded.right)),
  );

  if (Either.isLeft(outcome)) return refused(explain(outcome.left), { values });

  revalidatePath("/billing");
  /**
   * Landing on the fee note rather than back on the list, for the same reason
   * intake lands on the matter file: the number the client will quote was just
   * assigned, and the fee note is where it is shown.
   */
  redirect(`/billing/invoices/${outcome.right.id}`);
}

// ── Recording a payment ───────────────────────────────────────────────────

export async function recordPayment(
  id: string,
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const values = typedValues(form);
  const invoice = invoiceId(id);
  if (Either.isLeft(invoice)) {
    return refused("That is not a fee-note id.", { values });
  }

  const decoded = Schema.decodeUnknownEither(ReceivePaymentForm)(
    submitted(form),
    { errors: "all" },
  );

  if (Either.isLeft(decoded)) return fromParseError(decoded.left, values);

  const outcome = await attemptAs(
    Effect.flatMap(BillingService, (billing) =>
      billing.recordPayment(invoice.right, asPayment(decoded.right)),
    ),
  );

  if (Either.isLeft(outcome)) return refused(explain(outcome.left), { values });

  revalidatePath(`/billing/invoices/${id}`);
  revalidatePath("/billing");
  return IDLE;
}

// ── Settling from client money ────────────────────────────────────────────

export async function settleFromTrust(
  id: string,
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const values = typedValues(form);
  const invoice = invoiceId(id);
  if (Either.isLeft(invoice)) {
    return refused("That is not a fee-note id.", { values });
  }

  const decoded = Schema.decodeUnknownEither(SettleFromTrustForm)(
    submitted(form),
    { errors: "all" },
  );

  if (Either.isLeft(decoded)) return fromParseError(decoded.left, values);

  const outcome = await attemptAs(
    Effect.flatMap(BillingService, (billing) =>
      billing.settle(invoice.right, asSettlement(decoded.right)),
    ),
  );

  if (Either.isLeft(outcome)) return refused(explain(outcome.left), { values });

  revalidatePath(`/billing/invoices/${id}`);
  revalidatePath("/billing");
  return IDLE;
}

// ── Receiving client money ────────────────────────────────────────────────

export async function recordDeposit(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const values = typedValues(form);
  const decoded = Schema.decodeUnknownEither(RecordDepositForm)(
    submitted(form),
    { errors: "all" },
  );

  if (Either.isLeft(decoded)) return fromParseError(decoded.left, values);

  const outcome = await attemptAs(
    Effect.flatMap(BillingService, (billing) =>
      billing.deposit(asDeposit(decoded.right)),
    ),
  );

  if (Either.isLeft(outcome)) return refused(explain(outcome.left), { values });

  revalidatePath("/billing");
  return IDLE;
}
