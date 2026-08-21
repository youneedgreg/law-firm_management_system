import { Schema } from "effect";
import * as Billing from "../domain/billing/invoice";
import * as Status from "../domain/case/status";
import * as Conflicts from "../domain/client/conflicts";
import * as Permissions from "../domain/identity/permissions";
import * as Identity from "../domain/identity/principal";
import { AdvocateId, CaseId, ClientId } from "../domain/shared/ids";
import * as Money from "../domain/shared/money";
import * as BillingService from "../services/billing-service";
import * as Documents from "../domain/document/document";
import * as DocumentService from "../services/document-service";
import * as HearingService from "../services/hearing-service";
import * as TaskService from "../services/task-service";
import * as MessageService from "../services/message-service";
import * as TimeService from "../services/time-service";
import * as CaseService from "../services/case-service";
import * as ClientService from "../services/client-service";
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

/**
 * A conflict finding, on the wire.
 *
 * `concern` is a *sentence*, and it crosses rather than being reconstituted
 * from the kind — which is the opposite of what every failure in this API does.
 * The reason is that the sentence is not a refusal explaining itself; it is
 * professional guidance the domain wrote for an advocate to read, and a client
 * that rephrased it would be rephrasing advice.
 */
export const ConflictFinding = Schema.Struct({
  kind: Conflicts.FindingKind,
  party: Schema.String,
  caseId: CaseId,
  caseNumber: Schema.String,
  matterClosed: Schema.Boolean,
  concern: Schema.String,
}).annotations({
  identifier: "ConflictFinding",
  description: "Something the screen matched, and why it might matter",
});

/**
 * The result of a screen.
 *
 * There is no `hasConflict` field and there never will be. The LSK test is
 * whether representation would be "materially and adversely affected" — a
 * judgement about a specific retainer, made by an advocate who knows the facts.
 * `mattersSearched` is on the wire for the same reason: an empty finding list
 * is a statement about the records searched, not about the world, and "nothing
 * across 1,240 matters" and "nothing across 3" are very different claims.
 */
export const ScreeningResult = Schema.Struct({
  findings: Schema.Array(ConflictFinding),
  mattersSearched: Schema.Int,
  screenedAt: Wire.Timestamp,
}).annotations({
  identifier: "ScreeningResult",
  description:
    "What the conflict screen matched, and what it searched. It screens; it " +
    "does not decide",
});

export const IntakeEnquiry = Schema.Struct({
  clientName: Schema.NonEmptyTrimmedString,
  opposingNames: Schema.Array(Schema.NonEmptyTrimmedString),
}).annotations({
  identifier: "IntakeEnquiry",
  description: "A prospective retainer, to be screened",
});

export const TakeOnClient = Schema.Union(
  Schema.Struct({
    ...ClientService.TakeOnClient.members[0].fields,
    onboardedOn: Wire.Timestamp,
  }),
  Schema.Struct({
    ...ClientService.TakeOnClient.members[1].fields,
    onboardedOn: Wire.Timestamp,
  }),
).annotations({
  identifier: "TakeOnClient",
  description:
    "A new client. The union is preserved rather than flattened: a company " +
    "must name somebody who can instruct, and an individual has nobody to name",
});

export const AmendClient = Schema.Struct({
  ...ClientService.AmendClient.fields,
}).annotations({
  identifier: "AmendClient",
  description:
    "Every field optional; absence means leave alone. The client's kind is " +
    "not editable — an individual who turns out to be a company is a " +
    "different client, not a correction",
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

export const TrustAccountView = Schema.Struct({
  clientId: ClientId,
  clientName: Schema.String,
  deposits: Money.Money,
  withdrawals: Money.Money,
  balance: Money.Money,
}).annotations({
  identifier: "TrustAccountView",
  description:
    "What the firm holds for one client. Derived from the movements, never " +
    "stored — a balance that can disagree with its own history is the one " +
    "number that must not",
});

/**
 * The billing screen.
 *
 * `trust` and `trustHeld` are **optional**, and that is a statement rather than
 * a convenience. A caller holding `invoice:read` and not `trust:read` gets the
 * receivables with the client-account section *absent*; an empty array would
 * say the firm holds no client money, which is a different and much more
 * alarming claim. JSON has no `undefined`, so an absent optional is an absent
 * key — which is exactly the distinction wanted.
 */
export const Receivables = Schema.Struct({
  invoices: Schema.Array(InvoiceView),
  billed: Money.Money,
  collected: Money.Money,
  outstanding: Money.Money,
  overdue: Money.Money,
  trust: Schema.optional(Schema.Array(TrustAccountView)),
  trustHeld: Schema.optional(Money.Money),
}).annotations({
  identifier: "Receivables",
  description:
    "The firm's fee notes and, for whoever may see it, the client account",
});

export const TrustLedgerView = Schema.Struct({
  clientId: ClientId,
  clientName: Schema.String,
  balance: Money.Money,
  movements: Schema.Array(Wire.TrustMovement),
}).annotations({
  identifier: "TrustLedgerView",
  description: "One client's trust ledger, oldest movement first",
});

/**
 * Raising a fee note, over the wire.
 *
 * The dates are restated as `Timestamp`s for the same reason every other
 * request schema restates them, and `lines` is the domain's own
 * `NonEmptyArray(InvoiceLine)` unchanged — every field on a line is already a
 * JSON value, so there is nothing to derive.
 */
export const RaiseInvoice = Schema.Struct({
  ...BillingService.RaiseInvoice.fields,
  issuedOn: Wire.Timestamp,
  dueOn: Wire.Timestamp,
}).annotations({
  identifier: "RaiseInvoice",
  description: "A new fee note. Its number is assigned by the firm, not chosen",
});

/**
 * A payment arriving from outside.
 *
 * Carries the same M-Pesa rule as everything else that describes a payment: a
 * confirmation code is required when the method is M-Pesa. The predicate is
 * imported from the domain rather than restated, so there is one statement of
 * the rule and this is an application of it.
 */
export const ReceivePayment = Schema.Struct({
  ...Billing.PaymentFields,
  receivedOn: Wire.Timestamp,
}).pipe(
  Schema.filter((payment) =>
    Billing.isReconcilable(payment) ? undefined : Billing.RECONCILABLE_MESSAGE,
  ),
  Schema.annotations({
    identifier: "ReceivePayment",
    description:
      "Money received against a fee note. An M-Pesa payment must carry its " +
      "confirmation code: it is the only thing the statement reconciles against",
  }),
);

export const RecordDeposit = Schema.Struct({
  ...BillingService.RecordDeposit.fields,
  receivedOn: Wire.Timestamp,
}).annotations({
  identifier: "RecordDeposit",
  description: "Client money paid into client account",
});

/**
 * Settling a fee note from client money.
 *
 * There is no `reason` field, and the omission is the rule: Rule 9 permits a
 * withdrawal only for enumerated purposes, and the purpose of this operation is
 * fixed at "Transfer to office account for costs". Offering the choice would be
 * offering a way to label a costs transfer as a refund.
 */
export const SettleFromTrust = Schema.Struct({
  ...BillingService.SettleFromTrust.fields,
  settledOn: Wire.Timestamp,
}).annotations({
  identifier: "SettleFromTrust",
  description:
    "Takes the firm's costs out of the client money it already holds. " +
    "Refused by Rule 10 if that client's own balance cannot cover it",
});

// ── Time ──────────────────────────────────────────────────────────────────

export const TimesheetLine = Schema.Struct({
  entry: Wire.TimeEntry,
  matterNumber: Schema.String,
  matterTitle: Schema.String,
  advocateName: Schema.String,
  value: Money.Money,
  hours: Schema.Number,
}).annotations({
  identifier: "TimesheetLine",
  description: "A time entry with the matter and fee-earner names resolved",
});

// ── Correspondence ────────────────────────────────────────────────────────

export const ThreadEntry = Schema.Struct({
  message: Wire.Message,
  authorName: Schema.Option(Schema.String),
  matterNumber: Schema.Option(Schema.String),
}).annotations({
  identifier: "ThreadEntry",
  description:
    "A message with the names its ids stand for. `authorName` is absent when " +
    "the client sent it — there is no individual to name",
});

export const Thread = Schema.Struct({
  clientId: ClientId,
  clientName: Schema.String,
  entries: Schema.Array(ThreadEntry),
  unread: Schema.Int,
}).annotations({
  identifier: "Thread",
  description:
    "One client's correspondence, oldest first. `unread` is what was waiting " +
    "when the thread was opened — reading it as a member of staff marks the " +
    "client's messages seen, and reading it as the client does not",
});

/**
 * One waiting client.
 *
 * `seen` is the field worth having and the reason this is not an unread count:
 * a message somebody opened and did not answer is *worse* than one nobody
 * opened, because it looks handled.
 */
export const Waiting = Schema.Struct({
  clientId: ClientId,
  clientName: Schema.String,
  since: Wire.Timestamp,
  hours: Schema.Int,
  body: Schema.String,
  seen: Schema.Boolean,
}).annotations({
  identifier: "Waiting",
  description:
    "A client with an unanswered question, and how long they have waited. " +
    "One row per client, timed from when they first asked — a run of chasing " +
    "messages is one conversation waiting, not three",
});

export const SendMessage = Schema.Struct({
  ...MessageService.SendMessage.fields,
}).annotations({
  identifier: "SendMessage",
  description:
    "No author and no timestamp: both are facts about the request. A member " +
    "of staff cannot send as a client, or as another advocate",
});

// ── Work ──────────────────────────────────────────────────────────────────

export const TaskSummary = Schema.Struct({
  task: Wire.Task,
  matter: Schema.Option(
    Schema.Struct({
      id: CaseId,
      number: Schema.String,
      title: Schema.String,
    }),
  ),
  assigneeName: Schema.String,
}).annotations({
  identifier: "TaskSummary",
  description:
    "A task with its matter and the person carrying it resolved. `matter` is " +
    "absent for firm work — reconciling the trust account has no file number",
});

/**
 * The work list, split once.
 *
 * Three arrays rather than one array a client filters, because the split turns
 * on a *clock reading* and the server made it. A client computing "overdue"
 * from `dueOn` and its own `Date.now()` would disagree with the server about a
 * task due today, in whichever direction its time zone runs — and the whole
 * point of the boundary between overdue and due-soon is that it is the start of
 * a day, not a moment.
 *
 * The three are exhaustive and disjoint: every open task is in exactly one, so
 * `openCount` equals their combined length.
 */
export const WorkList = Schema.Struct({
  overdue: Schema.Array(TaskSummary),
  dueSoon: Schema.Array(TaskSummary),
  later: Schema.Array(TaskSummary),
  openCount: Schema.Int,
}).annotations({
  identifier: "WorkList",
  description:
    "Everything outstanding, split into overdue, due within a week, and " +
    "later — from one read and one clock reading, so a task cannot appear in " +
    "two of them or in none",
});

export const RaiseTask = Schema.Struct({
  ...TaskService.RaiseTask.fields,
}).annotations({
  identifier: "RaiseTask",
  description:
    "`raisedOn` is absent: a task is raised now, by definition. A caller " +
    "choosing it could produce work that was overdue before it existed",
});

export const ReassignTask = Schema.Struct({
  assignedTo: AdvocateId,
}).annotations({
  identifier: "ReassignTask",
  description:
    'Its own operation rather than a general amendment, because "who was ' +
    'this given to, and when did that change" is the question asked when a ' +
    "deadline is missed",
});

export const Timesheet = Schema.Struct({
  lines: Schema.Array(TimesheetLine),
  totalMinutes: Schema.Int,
  billableMinutes: Schema.Int,
  utilisation: Schema.Number,
  billableValue: Money.Money,
  unbilledValue: Money.Money,
}).annotations({
  identifier: "Timesheet",
  description:
    "Recorded work, with the figures a firm manages by. `utilisation` counts " +
    "non-billable time rather than ignoring it — it is the number that " +
    "answers where the week went",
});

/**
 * The timesheet filters, as query parameters.
 *
 * `unbilledOnly` is `BooleanFromString` rather than `Boolean`, and the compiler
 * is what insists: a URL carries text, so a query-parameter schema has to be
 * *encodeable to strings*. `Schema.Boolean` encodes to a boolean and
 * `HttpApiEndpoint.setUrlParams` refuses it by name — a small, well-aimed type
 * error that stops `?unbilledOnly=false` arriving as the truthy string
 * `"false"`, which is exactly the bug a hand-rolled parser ships.
 */
export const TimesheetQuery = Schema.Struct({
  caseId: Schema.optional(CaseId),
  advocateId: Schema.optional(AdvocateId),
  unbilledOnly: Schema.optional(Schema.BooleanFromString),
});

export const WorkInProgress = Schema.Struct({
  caseId: CaseId,
  matterNumber: Schema.String,
  matterTitle: Schema.String,
  minutes: Schema.Int,
  value: Money.Money,
}).annotations({
  identifier: "WorkInProgress",
  description: "Billable work recorded against a matter and not yet billed",
});

/**
 * Recording work.
 *
 * No `advocateId`, and its absence is the rule rather than an omission: an
 * entry is attributed to whoever is asking, so a timesheet is a first-hand
 * record of the person's own work. See `services/time-service.ts`.
 */
export const RecordTime = Schema.Struct({
  ...TimeService.RecordTime.fields,
  workedOn: Wire.Timestamp,
}).annotations({
  identifier: "RecordTime",
  description: "Work done, recorded against the caller and an open matter",
});

export const AmendTime = Schema.Struct({
  ...TimeService.AmendTime.fields,
  workedOn: Schema.optional(Wire.Timestamp),
}).annotations({
  identifier: "AmendTime",
  description:
    "Every field optional; absence means leave alone. `caseId` is not among " +
    "them — work on the wrong matter is a deletion and a re-entry, not an edit",
});

/** Raising a fee note from a matter's unbilled time. */
export const RaiseFromTime = Schema.Struct({
  issuedOn: Wire.Timestamp,
  dueOn: Wire.Timestamp,
}).annotations({
  identifier: "RaiseFromTime",
  description:
    "The lines come from the timesheet, grouped by activity and rate. The " +
    "entries are claimed atomically, so two people billing the same matter " +
    "at once cannot both take the same hours",
});

// ── Court diary ───────────────────────────────────────────────────────────

export const DiaryEntry = Schema.Struct({
  hearing: Wire.Hearing,
  matterNumber: Schema.String,
  matterTitle: Schema.String,
  clientName: Schema.String,
  advocateName: Schema.String,
  courtName: Schema.String,
}).annotations({
  identifier: "DiaryEntry",
  description: "A court date with the names and the court resolved",
});

/**
 * The diary, cut at one moment.
 *
 * Three lists from one clock reading, which is why they are one response rather
 * than three endpoints: `upcoming` and `awaitingOutcome` are the same set either
 * side of `asAt`, and a caller assembling them from two requests would get a
 * hearing in both or neither depending on how long the second one took.
 */
export const Diary = Schema.Struct({
  awaitingOutcome: Schema.Array(DiaryEntry),
  upcoming: Schema.Array(DiaryEntry),
  past: Schema.Array(DiaryEntry),
  asAt: Wire.Timestamp,
}).annotations({
  identifier: "Diary",
  description:
    "The court diary. `awaitingOutcome` is the report that matters: dates " +
    "that have passed with nothing recorded, which is either an " +
    "administrative gap or a missed attendance",
});

export const ListHearing = Schema.Struct({
  ...HearingService.ListHearing.fields,
  scheduledFor: Wire.Timestamp,
}).annotations({
  identifier: "ListHearing",
  description:
    "Lists a matter for hearing. The court is supplied whole — a tagged " +
    "union cannot express a magistrates' court with no rank, and four loose " +
    "fields can",
});

/**
 * Recording how a hearing went.
 *
 * The outcome is the domain's tagged union, so an adjournment **cannot** be
 * submitted without the date the matter went to. That is the single most useful
 * constraint in this module: an adjournment with no destination is a matter
 * quietly falling off the diary.
 *
 * An adjournment also *lists* the follow-on hearing, in the same transaction —
 * see the endpoint description.
 */
export const RecordOutcome = Schema.Struct({
  outcome: Schema.Union(
    Schema.TaggedStruct("Heard", { note: Schema.optional(Schema.String) }),
    Schema.TaggedStruct("Adjourned", {
      adjournedTo: Wire.Timestamp,
      reason: Schema.NonEmptyTrimmedString,
    }),
    Schema.TaggedStruct("NotReached", { note: Schema.optional(Schema.String) }),
    Schema.TaggedStruct("Withdrawn", { note: Schema.optional(Schema.String) }),
  ),
}).annotations({ identifier: "RecordOutcome" });

/** What recording an outcome produces: the hearing, and the follow-on if any. */
export const RecordedOutcome = Schema.Struct({
  hearing: Wire.Hearing,
  next: Schema.optional(Wire.Hearing),
}).annotations({
  identifier: "RecordedOutcome",
  description:
    "`next` is present exactly when the hearing was adjourned: the follow-on " +
    "date, already listed, so the matter is on the diary before anybody " +
    "closes the page",
});

// ── Documents ─────────────────────────────────────────────────────────────

export const DocumentSummary = Schema.Struct({
  document: Wire.Document,
  matterNumber: Schema.String,
  matterTitle: Schema.String,
  current: Schema.Struct({
    ...Documents.Version.fields,
    uploadedOn: Wire.Timestamp,
  }),
  versionCount: Schema.Int,
}).annotations({
  identifier: "DocumentSummary",
  description: "A document, its matter, and the version currently in force",
});

/**
 * A signed URL, and when it stops working.
 *
 * `expiresAt` is on the wire because a caller has to know: this URL *is* the
 * authorisation once issued — a CDN fetch carries no session — so it is
 * deliberately short-lived, and a consumer that cached it for an hour would be
 * caching a 403.
 */
export const Download = Schema.Struct({
  url: Schema.String,
  name: Schema.String,
  expiresAt: Wire.Timestamp,
}).annotations({
  identifier: "Download",
  description:
    "A fifteen-minute signed URL for the current version. The permission and " +
    "the scope are checked before it is minted, so it grants exactly what the " +
    "caller was already entitled to — and nothing after it expires",
});

export const UploadDocument = Schema.Struct({
  ...DocumentService.UploadDocument.fields,
}).annotations({
  identifier: "UploadDocument",
  description:
    "The particulars. The bytes travel as multipart alongside; a caller does " +
    "not choose the storage key, which is derived from the matter, the " +
    "document and the version",
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
  readonly trustAccountView: Identical<
    typeof TrustAccountView.Type,
    BillingService.TrustAccountView
  >;
  readonly receivables: Identical<
    typeof Receivables.Type,
    BillingService.Receivables
  >;
  readonly trustLedgerView: Identical<
    typeof TrustLedgerView.Type,
    BillingService.TrustLedgerView
  >;
  readonly raiseInvoice: Identical<
    typeof RaiseInvoice.Type,
    BillingService.RaiseInvoice
  >;
  readonly receivePayment: Identical<
    typeof ReceivePayment.Type,
    BillingService.ReceivePayment
  >;
  readonly recordDeposit: Identical<
    typeof RecordDeposit.Type,
    BillingService.RecordDeposit
  >;
  readonly settleFromTrust: Identical<
    typeof SettleFromTrust.Type,
    BillingService.SettleFromTrust
  >;
  readonly timesheetLine: Identical<
    typeof TimesheetLine.Type,
    TimeService.TimesheetLine
  >;
  readonly timesheet: Identical<typeof Timesheet.Type, TimeService.Timesheet>;
  readonly timesheetQuery: Identical<
    typeof TimesheetQuery.Type,
    TimeService.TimesheetFilter
  >;
  readonly recordTime: Identical<
    typeof RecordTime.Type,
    TimeService.RecordTime
  >;
  readonly amendTime: Identical<typeof AmendTime.Type, TimeService.AmendTime>;
  readonly conflictFinding: Identical<
    typeof ConflictFinding.Type,
    Conflicts.ConflictFinding
  >;
  readonly screeningResult: Identical<
    typeof ScreeningResult.Type,
    Conflicts.ScreeningResult
  >;
  readonly intakeEnquiry: Identical<
    typeof IntakeEnquiry.Type,
    Conflicts.IntakeEnquiry
  >;
  readonly takeOnClient: Identical<
    typeof TakeOnClient.Type,
    ClientService.TakeOnClient
  >;
  readonly amendClient: Identical<
    typeof AmendClient.Type,
    ClientService.AmendClient
  >;
  readonly diaryEntry: Identical<
    typeof DiaryEntry.Type,
    HearingService.DiaryEntry
  >;
  readonly diary: Identical<typeof Diary.Type, HearingService.Diary>;
  readonly listHearing: Identical<
    typeof ListHearing.Type,
    HearingService.ListHearing
  >;
  readonly recordOutcome: Identical<
    typeof RecordOutcome.Type,
    HearingService.RecordOutcome
  >;
  readonly documentSummary: Identical<
    typeof DocumentSummary.Type,
    DocumentService.DocumentSummary
  >;
  readonly download: Identical<typeof Download.Type, DocumentService.Download>;
  readonly uploadDocument: Identical<
    typeof UploadDocument.Type,
    DocumentService.UploadDocument
  >;
  readonly taskSummary: Identical<
    typeof TaskSummary.Type,
    TaskService.TaskSummary
  >;
  readonly workList: Identical<typeof WorkList.Type, TaskService.WorkList>;
  readonly raiseTask: Identical<typeof RaiseTask.Type, TaskService.RaiseTask>;
  readonly threadEntry: Identical<
    typeof ThreadEntry.Type,
    MessageService.ThreadEntry
  >;
  readonly thread: Identical<typeof Thread.Type, MessageService.Thread>;
  readonly waiting: Identical<typeof Waiting.Type, MessageService.Waiting>;
  readonly sendMessage: Identical<
    typeof SendMessage.Type,
    MessageService.SendMessage
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
  trustAccountView: true,
  receivables: true,
  trustLedgerView: true,
  raiseInvoice: true,
  receivePayment: true,
  recordDeposit: true,
  settleFromTrust: true,
  timesheetLine: true,
  timesheet: true,
  timesheetQuery: true,
  recordTime: true,
  amendTime: true,
  conflictFinding: true,
  screeningResult: true,
  intakeEnquiry: true,
  takeOnClient: true,
  amendClient: true,
  diaryEntry: true,
  diary: true,
  listHearing: true,
  recordOutcome: true,
  documentSummary: true,
  download: true,
  uploadDocument: true,
  taskSummary: true,
  workList: true,
  raiseTask: true,
  threadEntry: true,
  thread: true,
  waiting: true,
  sendMessage: true,
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
  readonly receivables: IsJson<typeof Receivables.Encoded>;
  readonly trustLedgerView: IsJson<typeof TrustLedgerView.Encoded>;
  readonly raiseInvoice: IsJson<typeof RaiseInvoice.Encoded>;
  readonly receivePayment: IsJson<typeof ReceivePayment.Encoded>;
  readonly recordDeposit: IsJson<typeof RecordDeposit.Encoded>;
  readonly settleFromTrust: IsJson<typeof SettleFromTrust.Encoded>;
  readonly timesheet: IsJson<typeof Timesheet.Encoded>;
  readonly timesheetQuery: IsJson<typeof TimesheetQuery.Encoded>;
  readonly recordTime: IsJson<typeof RecordTime.Encoded>;
  readonly amendTime: IsJson<typeof AmendTime.Encoded>;
  readonly workInProgress: IsJson<typeof WorkInProgress.Encoded>;
  readonly screeningResult: IsJson<typeof ScreeningResult.Encoded>;
  readonly intakeEnquiry: IsJson<typeof IntakeEnquiry.Encoded>;
  readonly takeOnClient: IsJson<typeof TakeOnClient.Encoded>;
  readonly amendClient: IsJson<typeof AmendClient.Encoded>;
  readonly diary: IsJson<typeof Diary.Encoded>;
  readonly listHearing: IsJson<typeof ListHearing.Encoded>;
  readonly recordOutcome: IsJson<typeof RecordOutcome.Encoded>;
  readonly recordedOutcome: IsJson<typeof RecordedOutcome.Encoded>;
  readonly documentSummary: IsJson<typeof DocumentSummary.Encoded>;
  readonly download: IsJson<typeof Download.Encoded>;
  readonly uploadDocument: IsJson<typeof UploadDocument.Encoded>;
  readonly taskSummary: IsJson<typeof TaskSummary.Encoded>;
  readonly workList: IsJson<typeof WorkList.Encoded>;
  readonly raiseTask: IsJson<typeof RaiseTask.Encoded>;
  readonly thread: IsJson<typeof Thread.Encoded>;
  readonly waiting: IsJson<typeof Waiting.Encoded>;
  readonly sendMessage: IsJson<typeof SendMessage.Encoded>;
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
  receivables: true,
  trustLedgerView: true,
  raiseInvoice: true,
  receivePayment: true,
  recordDeposit: true,
  settleFromTrust: true,
  timesheet: true,
  timesheetQuery: true,
  recordTime: true,
  amendTime: true,
  workInProgress: true,
  screeningResult: true,
  intakeEnquiry: true,
  takeOnClient: true,
  amendClient: true,
  diary: true,
  listHearing: true,
  recordOutcome: true,
  recordedOutcome: true,
  documentSummary: true,
  download: true,
  uploadDocument: true,
  taskSummary: true,
  workList: true,
  raiseTask: true,
  thread: true,
  waiting: true,
  sendMessage: true,
};
