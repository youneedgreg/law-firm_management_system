import { Schema } from "effect";
import * as Billing from "../domain/billing/invoice";
import * as Status from "../domain/case/status";
import * as Permissions from "../domain/identity/permissions";
import * as Identity from "../domain/identity/principal";
import { AdvocateId, ClientId } from "../domain/shared/ids";
import * as Money from "../domain/shared/money";
import type * as BillingService from "../services/billing-service";
import * as CaseService from "../services/case-service";
import type * as ClientService from "../services/client-service";
import * as Wire from "./wire";

/**
 * The composed shapes the API returns, and the requests it accepts.
 *
 * `wire.ts` describes the *entities*. This describes what a caller actually
 * receives: a matter with the two names a list has to show, a matter file with
 * its client and its permitted next statuses, an invoice with the figures the
 * domain refuses to store. Each already exists as an interface on a service —
 * this says the same shape in a form that can be validated and published, and
 * `RESPONSES_MATCH_SERVICES` at the bottom is what stops the two becoming two.
 *
 * The request schemas are built from `CaseService`'s own fields with the dates
 * restated, exactly as `wire.ts` builds the entities from the domain's. The
 * service owns what opening a matter *requires*; this owns only how it is
 * spelled on a wire.
 *
 * ## What this module depends on, and what that costs
 *
 * It imports `services/` at runtime — here for the request shapes, and in
 * `failures.ts` for the error classes. That is deliberate and not really
 * avoidable: the point of the arrangement is that the client decodes a refusal
 * into *the same class* the server failed with, `reason` getter included. A
 * re-declared copy of `AdvocateMayNotFile` in the API layer would be a
 * different class that happened to share a name, and the two would drift on the
 * first change to either.
 *
 * The consequence is that the contract carries `services/` into any bundle it
 * is imported from, including the browser's in Phase 5. Today that is free —
 * `case-service.ts` and `repositories.ts` import nothing but `effect` and
 * `domain/`, no driver and no Node built-ins. If a server-only dependency ever
 * lands in `services/`, the fix is to move the error classes to a shared module
 * rather than to duplicate them, and the boundary rules will make the day that
 * happens loud.
 *
 * Note what is *not* here: no field invented for the wire, no service type
 * flattened for convenience. A response reshaped into something more pleasant
 * to consume would be a third model to keep in step, and the client decoding it
 * would hand back something the server has never heard of.
 */

// ── The same two proofs as wire.ts, applied to composed shapes ────────────

type Identical<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

type Json =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly Json[]
  | { readonly [key: string]: Json };

type IsJson<T> = [T] extends [Json] ? true : false;

// ── Cases ─────────────────────────────────────────────────────────────────

export const CaseSummary = Schema.Struct({
  matter: Wire.Case,
  clientName: Schema.String,
  advocateName: Schema.String,
}).annotations({
  identifier: "CaseSummary",
  description:
    "A matter with its client and advocate names resolved, for a list view",
});

export const LimitationView = Schema.Struct({
  window: Wire.LimitationWindow,
  daysRemaining: Schema.Int,
  urgency: Schema.Literal("expired", "critical", "approaching", "comfortable"),
}).annotations({
  identifier: "LimitationView",
  description: "The limitation position as at the moment of the request",
});

export const CaseFile = Schema.Struct({
  matter: Wire.Case,
  client: Wire.Client,
  advocate: Wire.Advocate,
  /**
   * Absent where no window can be computed. A matter with no accrual date has
   * no limitation date, and inventing one would put a confident wrong figure in
   * front of an advocate.
   */
  limitation: Schema.optional(LimitationView),
  /**
   * Built from the domain's transition table, so a caller never needs a second
   * copy of the state machine to know which moves to offer.
   */
  mayBeMovedTo: Schema.Array(Status.CaseStatus),
}).annotations({
  identifier: "CaseFile",
  description: "Everything the matter file shows, assembled in one request",
});

export const IntakeChoices = Schema.Struct({
  clients: Schema.Array(Schema.Struct({ id: ClientId, name: Schema.String })),
  advocates: Schema.Array(
    Schema.Struct({
      id: AdvocateId,
      name: Schema.String,
      role: Schema.String,
      /**
       * Computed rather than left to the caller. The rule is
       * `mayAppearInCourt` and it depends on today's date; a form deciding it
       * from `role` alone would be a second, wrong copy of the Advocates Act
       * check the service still enforces on submission.
       */
      mayFile: Schema.Boolean,
    }),
  ),
}).annotations({
  identifier: "IntakeChoices",
  description: "Who a matter may be opened for, and who may carry it",
});

/** The caseload filters, as query parameters. */
export const CaseloadQuery = Schema.Struct({
  status: Schema.optional(Status.CaseStatus),
  /** Scopes to one advocate's own matters — the "My cases" view. */
  advocateId: Schema.optional(AdvocateId),
});

/**
 * Intake, over JSON.
 *
 * `id`, `number` and `status` are absent because the service does not accept
 * them: a caller does not choose an identifier, does not choose a matter
 * reference, and does not open a file in any state other than New. Offering
 * those fields would be offering three ways to write a record the firm's
 * conventions say cannot exist.
 */
export const OpenMatter = Schema.Struct({
  ...CaseService.OpenMatter.fields,
  accruedOn: Schema.optional(Schema.Date),
  openedOn: Schema.Date,
  filedOn: Schema.optional(Schema.Date),
}).annotations({
  identifier: "OpenMatter",
  description:
    "What opening a matter requires. `court` is supplied whole rather than " +
    "assembled from loose fields — a tagged union cannot express a " +
    "magistrates' court with no rank, and four free inputs can",
});

/**
 * The editable particulars of an existing matter.
 *
 * `status` is not among them, and neither is `clientId`. A status moves through
 * the transition endpoint, which enforces the state machine; a matter that
 * changed client is not an edit but a different matter, and reassigning one
 * would detach every invoice and trust movement already raised against it.
 */
export const AmendMatter = Schema.Struct({
  ...CaseService.AmendMatter.fields,
  accruedOn: Schema.optional(Schema.Date),
  filedOn: Schema.optional(Schema.Date),
}).annotations({
  identifier: "AmendMatter",
  description:
    "Every field is optional and absence means leave alone, so a submission " +
    "of four fields cannot blank the other six",
});

/**
 * A status move: the *target* only.
 *
 * The current status is read from storage rather than accepted from the caller,
 * which is what makes a stale client or a double submit fail rather than
 * overwrite.
 */
export const TransitionRequest = Schema.Struct({
  to: Status.CaseStatus,
}).annotations({ identifier: "TransitionRequest" });

// ── Clients ───────────────────────────────────────────────────────────────

export const ClientSummary = Schema.Struct({
  client: Wire.Client,
  primaryContact: Schema.String,
  openMatters: Schema.Int,
  totalMatters: Schema.Int,
}).annotations({
  identifier: "ClientSummary",
  description: "A client, and how much of the firm's work is theirs",
});

export const ClientFile = Schema.Struct({
  client: Wire.Client,
  primaryContact: Schema.String,
  matters: Schema.Array(Wire.Case),
}).annotations({
  identifier: "ClientFile",
  description: "A client and the matters on their file",
});

// ── Session ───────────────────────────────────────────────────────────────

/**
 * The signed-in principal, and what they may do.
 *
 * `principal` is the domain union unchanged — every field on it is already a
 * string, so unlike the entities in `wire.ts` there is no date to restate and
 * nothing to derive a wire copy from. Sending the union rather than flattening
 * it to `{ role, clientId? }` is the point: the browser gets the same shape the
 * server reasons about, and a screen that reads `clientId` has to narrow on the
 * tag first.
 *
 * `permissions` is computed rather than stored, from the same table the
 * services enforce with. It is the caller's own list; it says nothing about
 * anybody else's.
 */
export const Me = Schema.Struct({
  principal: Identity.Principal,
  permissions: Schema.Array(Permissions.Permission),
}).annotations({
  identifier: "Me",
  description: "Who the caller is, and the permissions their role holds",
});

// ── Billing ───────────────────────────────────────────────────────────────

export const InvoiceView = Schema.Struct({
  invoice: Wire.Invoice,
  /**
   * Total, paid, outstanding and status are derived on every read and never
   * stored — an invoice whose stored total disagrees with its own lines is not
   * a thing anyone enjoys finding in a fee dispute. They are sent anyway,
   * because "Overdue" depends on the moment of the request, and one clock
   * reading per request is what stops a list and a detail page disagreeing
   * about the same row in the same second.
   */
  total: Money.Money,
  paid: Money.Money,
  outstanding: Money.Money,
  status: Billing.InvoiceStatus,
  daysOverdue: Schema.Int,
}).annotations({
  identifier: "InvoiceView",
  description: "A fee note with the figures the domain refuses to store",
});

// ── The proofs ────────────────────────────────────────────────────────────

/**
 * Each schema decodes to exactly the service type it stands for.
 *
 * This is the guard that earns the most here. `wire.ts` derives its schemas
 * from the domain's own `fields`, so most drift there is impossible by
 * construction; these are written out by hand, and a field added to
 * `CaseService.CaseFile` would otherwise be silently missing from the API and
 * from every client generated off it.
 */
export const RESPONSES_MATCH_SERVICES: {
  readonly caseSummary: Identical<
    typeof CaseSummary.Type,
    CaseService.CaseSummary
  >;
  readonly limitationView: Identical<
    typeof LimitationView.Type,
    CaseService.LimitationView
  >;
  readonly caseFile: Identical<typeof CaseFile.Type, CaseService.CaseFile>;
  readonly intakeChoices: Identical<
    typeof IntakeChoices.Type,
    CaseService.IntakeChoices
  >;
  readonly caseloadQuery: Identical<
    typeof CaseloadQuery.Type,
    CaseService.CaseloadFilter
  >;
  readonly openMatter: Identical<
    typeof OpenMatter.Type,
    CaseService.OpenMatter
  >;
  readonly amendMatter: Identical<
    typeof AmendMatter.Type,
    CaseService.AmendMatter
  >;
  readonly clientSummary: Identical<
    typeof ClientSummary.Type,
    ClientService.ClientSummary
  >;
  readonly clientFile: Identical<
    typeof ClientFile.Type,
    ClientService.ClientFile
  >;
  readonly invoiceView: Identical<
    typeof InvoiceView.Type,
    BillingService.InvoiceView
  >;
} = {
  caseSummary: true,
  limitationView: true,
  caseFile: true,
  intakeChoices: true,
  caseloadQuery: true,
  openMatter: true,
  amendMatter: true,
  clientSummary: true,
  clientFile: true,
  invoiceView: true,
};

/** And each encodes to something JSON can carry. */
export const RESPONSES_ARE_JSON: {
  readonly caseSummary: IsJson<typeof CaseSummary.Encoded>;
  readonly caseFile: IsJson<typeof CaseFile.Encoded>;
  readonly intakeChoices: IsJson<typeof IntakeChoices.Encoded>;
  readonly caseloadQuery: IsJson<typeof CaseloadQuery.Encoded>;
  readonly openMatter: IsJson<typeof OpenMatter.Encoded>;
  readonly amendMatter: IsJson<typeof AmendMatter.Encoded>;
  readonly clientSummary: IsJson<typeof ClientSummary.Encoded>;
  readonly clientFile: IsJson<typeof ClientFile.Encoded>;
  readonly invoiceView: IsJson<typeof InvoiceView.Encoded>;
} = {
  caseSummary: true,
  caseFile: true,
  intakeChoices: true,
  caseloadQuery: true,
  openMatter: true,
  amendMatter: true,
  clientSummary: true,
  clientFile: true,
  invoiceView: true,
};
