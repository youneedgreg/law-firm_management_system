import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi,
} from "@effect/platform";
import { Schema } from "effect";
import {
  CaseId,
  ClientId,
  DocumentId,
  TaskId,
  HearingId,
  InvoiceId,
  TimeEntryId,
} from "../domain/shared/ids";
import { Authentication } from "./authentication";
import * as Failures from "./failures";
import * as Responses from "./responses";
import * as Wire from "./wire";

/**
 * The contract.
 *
 * One description of this API, from which three things are derived and none of
 * them are written by hand: the server's routes and their validation
 * (`handlers/`), the client (`client.ts`), and the OpenAPI document
 * (`openapi.ts`). Change a path here and the client's call signature changes;
 * add a field to a response and the handler stops compiling until it returns
 * one. That is the property Phase 4 exists to demonstrate, and it is worth
 * being precise about what it costs to give up: a hand-written `fetch` wrapper
 * beside a hand-written route handler agrees with it only for as long as
 * somebody remembers to keep them agreeing, and nothing tells you when that
 * stopped.
 *
 * This module imports `domain/` and its two sibling schema modules, and nothing
 * else — no service, no repository, no Postgres. It is shared, so it has to be
 * importable from a browser; the boundary rule in `eslint.config.mjs` makes
 * that structural rather than a habit.
 *
 * ## Which groups exist, and why one does not
 *
 * `cases` is complete — read, open, amend, transition — because Phase 3 took
 * matters through the whole stack and there is a service behind every one.
 * `clients` and `billing` are read-only, which is exactly what their services
 * offer: the data is real, seeded, and served from Postgres, and the write
 * paths belong to Phase 7 along with the rest of those modules.
 *
 * The `documents` group was deliberately absent through Phase 4 to 6, because
 * documents had a domain model and two tables and nothing in between — no
 * repository, no row↔domain mapping, nothing seeded, and no upload path.
 * Endpoints would have served an empty array from an empty table. The whole
 * argument for generating a client from a contract is that the contract is
 * *true*, and shipping one that is not, to fill in a checkbox, would have spent
 * the only thing this design has going for it.
 *
 * Phase 7 built all four, so the group is here now — which is what the deferral
 * was waiting for rather than a change of mind.
 */

// ── Cases ─────────────────────────────────────────────────────────────────

/**
 * `/cases/intake-choices` sits above `/cases/:id` deliberately.
 *
 * The router prefers a static segment over a parameterised one, so the order
 * here is not what disambiguates them — but a reader should not have to know
 * that to be sure, and `intake-choices` is not a UUID, so the parameterised
 * route would refuse it anyway. Two independent reasons it cannot be captured,
 * and a test that asserts it.
 */
export class CasesGroup extends HttpApiGroup.make("cases")
  .add(
    HttpApiEndpoint.get("caseload", "/cases")
      .setUrlParams(Responses.CaseloadQuery)
      .addSuccess(Schema.Array(Responses.CaseSummary))
      /**
       * 404 on a *list*, which looks odd and is right. For a portal user the
       * caseload is their own client record's matters, so a login pointing at
       * a client that has since been deleted has nothing to answer with — and
       * an empty list would say "you have no matters" to somebody whose record
       * is missing.
       */
      .addError(Failures.NotFound)
      .annotateContext(
        OpenApi.annotations({
          title: "The caseload",
          description:
            "Every matter, with its client and advocate names resolved — or, " +
            "for a signed-in client, their own. Optionally filtered by " +
            "status, or scoped to one advocate.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("intakeChoices", "/cases/intake-choices")
      .addSuccess(Responses.IntakeChoices)
      .annotateContext(
        OpenApi.annotations({
          title: "Intake choices",
          description:
            "The clients a matter may be opened for and the staff who may " +
            "carry it. Staff who have left the firm are omitted rather than " +
            "offered and refused; those who may not file are marked.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("file")`/cases/${HttpApiSchema.param("id", CaseId)}`
      .addSuccess(Responses.CaseFile)
      .addError(Failures.NotFound)
      .annotateContext(
        OpenApi.annotations({
          title: "The matter file",
          description:
            "The matter, the client and advocate it names, the limitation " +
            "position as at now, and the statuses it may move to.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("open", "/cases")
      .setPayload(Responses.OpenMatter)
      .addSuccess(Wire.Case, { status: 201 })
      .addError(Failures.NotFound)
      .addError(Failures.AdvocateNotInPractice)
      .addError(Failures.AdvocateMayNotFile)
      .addError(Failures.MatterReferencesExhausted)
      .addError(Failures.CaseNumberTaken)
      .addError(Failures.OutsideCourtJurisdiction)
      .addError(Failures.CannotFileWithoutValue)
      .addError(Failures.FilingPrecedesIntake)
      .addError(Failures.CauseNumberWithoutFiling)
      .addError(Failures.IncompleteLimitation)
      .annotateContext(
        OpenApi.annotations({
          title: "Open a matter",
          description:
            "Assigns the next matter reference for the year the file was " +
            "opened. The reference is derived from what is already stored, " +
            "so two simultaneous intakes compute the same one; the unique " +
            "index refuses the loser and this retries onto the next free " +
            "number. `CaseNumberTaken` therefore means three consecutive " +
            "collisions, which is no longer contention.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.patch("amend")`/cases/${HttpApiSchema.param("id", CaseId)}`
      .setPayload(Responses.AmendMatter)
      .addSuccess(Wire.Case)
      .addError(Failures.NotFound)
      .addError(Failures.AdvocateNotInPractice)
      .addError(Failures.AdvocateMayNotFile)
      .addError(Failures.CaseNumberTaken)
      .addError(Failures.OutsideCourtJurisdiction)
      .addError(Failures.CannotFileWithoutValue)
      .addError(Failures.FilingPrecedesIntake)
      .addError(Failures.CauseNumberWithoutFiling)
      .addError(Failures.IncompleteLimitation)
      .annotateContext(
        OpenApi.annotations({
          title: "Amend a matter",
          description:
            "A practising certificate is required only when this amendment " +
            "is itself the act of filing — adding a filing date to a matter " +
            "that had none. Correcting a matter filed in 2025 does not " +
            "re-file it, and demanding a current certificate for that would " +
            "make historic files uneditable over a year the system has no " +
            "record of.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post(
      "transition",
    )`/cases/${HttpApiSchema.param("id", CaseId)}/status`
      .setPayload(Responses.TransitionRequest)
      .addSuccess(Wire.Case)
      .addError(Failures.NotFound)
      .addError(Failures.InvalidTransition)
      .addError(Failures.HasOpenTasks)
      .addError(Failures.CaseNumberTaken)
      .annotateContext(
        OpenApi.annotations({
          title: "Move a matter through the lifecycle",
          description:
            "The current status is read from storage rather than taken from " +
            "the request, so a stale client fails instead of overwriting. " +
            "Re-declaring the current status is refused rather than treated " +
            "as a no-op: it is almost always a double submit, and accepting " +
            "it would record that nothing happened.\n\n" +
            "**Closing is the one move with a precondition outside the " +
            "matter.** A matter with open tasks on it is refused, because " +
            "closing does not delete those tasks — it removes them from every " +
            "list a person looks at, which is how work stops being done " +
            "without anyone deciding against it.",
        }),
      ),
  )
  .annotateContext(
    OpenApi.annotations({
      title: "Cases",
      description: "Matters on the firm's books.",
    }),
  ) {}

// ── Clients ───────────────────────────────────────────────────────────────

export class ClientsGroup extends HttpApiGroup.make("clients")
  .add(
    HttpApiEndpoint.get("directory", "/clients")
      .addSuccess(Schema.Array(Responses.ClientSummary))
      .addError(Failures.NotFound)
      .annotateContext(
        OpenApi.annotations({
          title: "The client list",
          description:
            "Every client, with their caseload counted. A signed-in client " +
            "sees exactly one entry: themselves.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("file")`/clients/${HttpApiSchema.param("id", ClientId)}`
      .addSuccess(Responses.ClientFile)
      .addError(Failures.NotFound)
      .annotateContext(
        OpenApi.annotations({
          title: "A client and their matters",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("screen", "/clients/screen")
      .setPayload(Responses.IntakeEnquiry)
      .addSuccess(Responses.ScreeningResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Screen a prospective retainer for conflicts",
          description:
            "Returns **findings**, never a verdict. The test is whether " +
            "representation would be materially and adversely affected — a " +
            "judgement about a specific retainer, made by an advocate who " +
            "knows the facts, and software cannot make it. `mattersSearched` " +
            "is returned because an empty finding list is a statement about " +
            "the records searched rather than about the world.\n\n" +
            "The screen is recorded in the audit trail: it is the one read in " +
            "this system that is, because 'was a conflict check run before " +
            "this file was opened' is asked afterwards by somebody who was " +
            "not there.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("takeOn", "/clients")
      .setPayload(Responses.TakeOnClient)
      .addSuccess(Wire.Client, { status: 201 })
      .addError(Failures.ClientNumbersExhausted)
      .annotateContext(
        OpenApi.annotations({
          title: "Take a client on",
          description:
            "The number is derived from what the firm has already issued. A " +
            "KRA PIN whose prefix does not match the client's kind is " +
            "accepted and flagged rather than refused — it is usually a sole " +
            "trader entered as a company, which is a conversation rather than " +
            "a validation error.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.patch(
      "amend",
    )`/clients/${HttpApiSchema.param("id", ClientId)}`
      .setPayload(Responses.AmendClient)
      .addSuccess(Wire.Client)
      .addError(Failures.NotFound)
      .addError(Failures.ContactsDoNotApply)
      .annotateContext(
        OpenApi.annotations({
          title: "Correct a client's particulars",
        }),
      ),
  )
  .annotateContext(
    OpenApi.annotations({
      title: "Clients",
      description:
        "Individuals and corporate entities, and the conflict screen that " +
        "runs before one is taken on.",
    }),
  ) {}

// ── Billing ───────────────────────────────────────────────────────────────

export class BillingGroup extends HttpApiGroup.make("billing")
  .add(
    HttpApiEndpoint.get(
      "forClient",
    )`/clients/${HttpApiSchema.param("clientId", ClientId)}/invoices`
      .addSuccess(Schema.Array(Responses.InvoiceView))
      .addError(Failures.NotFound)
      .annotateContext(
        OpenApi.annotations({
          title: "A client's fee notes",
          description:
            "An unknown client is a 404, not an empty list. " +
            '"This client has no invoices" and "there is no such client" ' +
            "are different answers, and a caller that cannot tell them apart " +
            "will show the wrong one.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get(
      "invoice",
    )`/invoices/${HttpApiSchema.param("id", InvoiceId)}`
      .addSuccess(Responses.InvoiceView)
      .addError(Failures.NotFound)
      .annotateContext(
        OpenApi.annotations({
          title: "One fee note",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("receivables", "/billing")
      .addSuccess(Responses.Receivables)
      .addError(Failures.NotFound)
      .annotateContext(
        OpenApi.annotations({
          title: "The firm's receivables",
          description:
            "Every fee note with its derived figures, and — for a caller who " +
            "also holds `trust:read` — the client account. `trust` is " +
            "**absent** rather than empty for a caller who does not: an empty " +
            "array would say the firm holds no client money, which is a very " +
            "different claim from 'you were not shown this'. A signed-in " +
            "client sees their own fee notes and no client account at all.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get(
      "ledger",
    )`/clients/${HttpApiSchema.param("clientId", ClientId)}/trust`
      .addSuccess(Responses.TrustLedgerView)
      .addError(Failures.NotFound)
      .annotateContext(
        OpenApi.annotations({
          title: "A client's trust ledger",
          description:
            "The movements, oldest first, and the balance they come to. The " +
            "balance is derived on every read and never stored — a stored one " +
            "can disagree with its own history, and this is the number that " +
            "must not.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("raise", "/invoices")
      .setPayload(Responses.RaiseInvoice)
      .addSuccess(Wire.Invoice, { status: 201 })
      .addError(Failures.NotFound)
      .addError(Failures.InvoiceNumberTaken)
      .addError(Failures.InvoiceNumbersExhausted)
      .annotateContext(
        OpenApi.annotations({
          title: "Raise a fee note",
          description:
            "The number is assigned from what has already been issued, so " +
            "two simultaneous writes compute the same one; the unique index " +
            "refuses the loser and this retries onto the next free number.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post(
      "recordPayment",
    )`/invoices/${HttpApiSchema.param("id", InvoiceId)}/payments`
      .setPayload(Responses.ReceivePayment)
      .addSuccess(Responses.InvoiceView, { status: 201 })
      .addError(Failures.NotFound)
      .addError(Failures.PaymentExceedsBalance)
      .addError(Failures.PaymentAlreadyRecorded)
      .annotateContext(
        OpenApi.annotations({
          title: "Record a payment",
          description:
            "Money received from outside: a cheque, a bank transfer, an " +
            "M-Pesa confirmation. An M-Pesa payment must carry its " +
            "confirmation code, and the same code cannot be recorded twice — " +
            "a partial unique index arbitrates, because the check and the " +
            "write have to be one operation.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post(
      "settle",
    )`/invoices/${HttpApiSchema.param("id", InvoiceId)}/settlement`
      .setPayload(Responses.SettleFromTrust)
      .addSuccess(Responses.InvoiceView, { status: 201 })
      .addError(Failures.NotFound)
      .addError(Failures.NothingOutstanding)
      .addError(Failures.PaymentExceedsBalance)
      .addError(Failures.TrustAccountUnderfunded)
      .annotateContext(
        OpenApi.annotations({
          title: "Settle a fee note from client money",
          description:
            "Takes the firm's costs out of what it already holds for that " +
            "client: one payment row and one Rule 9 transfer to office " +
            "account, written as a single transaction. Needs both " +
            "`invoice:write` and `trust:write`, which are deliberately not " +
            "held by the same role as `case:open` — the fee-earner who " +
            "raises a fee note cannot also pay it out of their client's money.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post(
      "raiseFromTime",
    )`/cases/${HttpApiSchema.param("caseId", CaseId)}/fee-note`
      .setPayload(Responses.RaiseFromTime)
      .addSuccess(Wire.Invoice, { status: 201 })
      .addError(Failures.NotFound)
      .addError(Failures.NothingToBill)
      .addError(Failures.TimeAlreadyBilled)
      .addError(Failures.InvoiceNumberTaken)
      .addError(Failures.InvoiceNumbersExhausted)
      .annotateContext(
        OpenApi.annotations({
          title: "Raise a fee note from recorded time",
          description:
            "The lines are the matter's unbilled work, grouped by activity " +
            "and rate — `Drafting, 12.5 hours at 20,000` rather than forty " +
            "narratives, which is how a bill of costs is actually presented. " +
            "The entries are claimed with `WHERE invoice_id IS NULL`, so two " +
            "people billing the same matter at once cannot both take the same " +
            "hours; the loser gets a 409 and nothing is written.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("deposit", "/trust/deposits")
      .setPayload(Responses.RecordDeposit)
      .addSuccess(Wire.TrustMovement, { status: 201 })
      .addError(Failures.NotFound)
      .annotateContext(
        OpenApi.annotations({
          title: "Receive client money",
          description:
            "Cannot be refused by a balance: Rule 4 requires client money to " +
            "be paid in without delay, and paying in never breaches one. It " +
            "is still audited, because a deposit nobody is recorded as having " +
            "received is the first half of a misappropriation.",
        }),
      ),
  )
  .annotateContext(
    OpenApi.annotations({
      title: "Billing",
      description:
        "Fee notes and client money. Totals and statuses are derived on " +
        "every read and never stored, so an invoice cannot disagree with its " +
        "own lines — and a trust balance cannot disagree with its own " +
        "movements.\n\n" +
        "Three ways money moves, kept as three operations because the " +
        "Advocates (Accounts) Rules turn on which one it is: a payment is " +
        "the client sending money to the firm, a deposit is client money " +
        "going into client account and staying the client's, and a " +
        "settlement is the firm taking its costs out of what it holds.",
    }),
  ) {}

// ── Time ──────────────────────────────────────────────────────────────────

/**
 * Recorded work.
 *
 * No endpoint here takes an `advocateId` on a *write*. Time is attributed to
 * whoever is asking, which is what makes a timesheet a first-hand record rather
 * than a reconstruction — see `services/time-service.ts` for what that costs.
 * `advocateId` on the read is a filter and means something different.
 */
export class TimeGroup extends HttpApiGroup.make("time")
  .add(
    HttpApiEndpoint.get("timesheet", "/time")
      .setUrlParams(Responses.TimesheetQuery)
      .addSuccess(Responses.Timesheet)
      .annotateContext(
        OpenApi.annotations({
          title: "The timesheet",
          description:
            "Recorded work with the matter and fee-earner names resolved, and " +
            "the firm's figures: utilisation, billable value, and what is " +
            "recorded but not yet billed.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("workInProgress", "/time/work-in-progress")
      .addSuccess(Schema.Array(Responses.WorkInProgress))
      .annotateContext(
        OpenApi.annotations({
          title: "Work in progress",
          description:
            "Billable time recorded and not yet billed, by matter, largest " +
            "first. The single most useful number a small practice usually " +
            "does not have.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("record", "/time")
      .setPayload(Responses.RecordTime)
      .addSuccess(Wire.TimeEntry, { status: 201 })
      .addError(Failures.NotFound)
      .addError(Failures.MatterIsClosed)
      .addError(Failures.NotAFeeEarner)
      .annotateContext(
        OpenApi.annotations({
          title: "Record work",
          description:
            "Attributed to the caller. There is no field that could say " +
            "otherwise, so every entry is the assertion of the person who did " +
            "the work.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.patch(
      "amend",
    )`/time/${HttpApiSchema.param("id", TimeEntryId)}`
      .setPayload(Responses.AmendTime)
      .addSuccess(Wire.TimeEntry)
      .addError(Failures.NotFound)
      .addError(Failures.BilledWorkIsFixed)
      .addError(Failures.NotAFeeEarner)
      .annotateContext(
        OpenApi.annotations({
          title: "Correct an entry",
          description:
            "Only your own, and only before it has been billed. Somebody " +
            "else's entry answers 404 rather than 403, for the same reason an " +
            "out-of-scope matter does: a refusal that distinguishes the two " +
            "confirms the record exists.",
        }),
      ),
  )
  .annotateContext(
    OpenApi.annotations({
      title: "Time",
      description:
        "Recorded work, which is where a firm's revenue comes from. " +
        "Non-billable time is recorded too — a model that stored only " +
        "billable work could not produce a utilisation figure at all.",
    }),
  ) {}

// ── The court diary ───────────────────────────────────────────────────────

/**
 * Court dates.
 *
 * The endpoint worth reading is `record`. Recording an adjournment **lists the
 * follow-on hearing in the same transaction** — because the failure this whole
 * module exists to prevent is a matter adjourned with nowhere recorded to have
 * gone, and a design in which recording the adjournment and listing the next
 * date are two separate acts is a design where the second one is forgotten at
 * four o'clock on a Friday.
 */
export class HearingsGroup extends HttpApiGroup.make("hearings")
  .add(
    HttpApiEndpoint.get("diary", "/hearings")
      .addSuccess(Responses.Diary)
      .addError(Failures.NotFound)
      .annotateContext(
        OpenApi.annotations({
          title: "The court diary",
          description:
            "Three lists cut at one moment: dates that have passed with " +
            "nothing recorded, dates still to come, and everything already " +
            "recorded. They come from one clock reading, so a hearing cannot " +
            "appear in two of them or in neither.\n\n" +
            "`awaitingOutcome` is the report that matters. A hearing whose " +
            "date has passed with no outcome is either an administrative gap " +
            "or a missed attendance, and the firm needs to know which before " +
            "the other side raises it.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("list", "/hearings")
      .setPayload(Responses.ListHearing)
      .addSuccess(Wire.Hearing, { status: 201 })
      .addError(Failures.NotFound)
      .addError(Failures.MatterNotOpen)
      .addError(Failures.ListedInThePast)
      .addError(Failures.OutsideCourtJurisdiction)
      .addError(Failures.CannotFileWithoutValue)
      .annotateContext(
        OpenApi.annotations({
          title: "List a matter for hearing",
          description:
            "The court is checked against the claim with the same " +
            "`canFileIn` intake uses: a magistrates' court that could not " +
            "have heard the claim at filing cannot hear it now either, and " +
            "two different answers to that question would be worse than none.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post(
      "record",
    )`/hearings/${HttpApiSchema.param("id", HearingId)}/outcome`
      .setPayload(Responses.RecordOutcome)
      .addSuccess(Responses.RecordedOutcome, { status: 201 })
      .addError(Failures.NotFound)
      .addError(Failures.OutcomeAlreadyRecorded)
      .addError(Failures.AdjournedIntoThePast)
      .annotateContext(
        OpenApi.annotations({
          title: "Record how a hearing went",
          description:
            "The outcome is a tagged union in which only `Adjourned` carries " +
            "a destination — and must. An adjournment with nowhere recorded " +
            "to have gone is a matter quietly falling off the diary, and the " +
            "shape makes it unrepresentable rather than merely discouraged.\n\n" +
            "**An adjournment also lists the follow-on hearing**, in the same " +
            "transaction, inheriting the court, the room and the advocate. It " +
            "comes back as `next`. Recording the outcome and listing the next " +
            "date as two separate requests would be two chances to do only " +
            "the first.",
        }),
      ),
  )
  .annotateContext(
    OpenApi.annotations({
      title: "Hearings",
      description:
        "The court diary — the reason a firm needs a system at all, because " +
        "a missed hearing can mean a matter dismissed for want of " +
        "prosecution.",
    }),
  ) {}

// ── Documents ─────────────────────────────────────────────────────────────

/**
 * Documents on a matter file — the group Phase 4 deliberately did not ship.
 *
 * The reasoning then was that documents had a domain model and two tables and
 * nothing in between: no repository, no row↔domain mapping, nothing seeded, and
 * no upload path. Endpoints would have served an empty array from an empty
 * table. "The whole argument for generating a client from a contract is that
 * the contract is *true*; shipping one that is not, to fill in a checkbox,
 * would spend the only thing this design has going for it."
 *
 * All four now exist, so the group lands — which is what that deferral was
 * waiting for rather than a change of mind.
 *
 * ## `download` returns a URL, not bytes
 *
 * The one endpoint here that is not obvious. The store is private, so a CDN
 * fetch needs the authorisation *in the URL*; this checks `document:read` and
 * the caller's scope and then mints a fifteen-minute signature. Streaming the
 * body through the API instead would push a 40 MB bundle of pleadings across
 * the network twice, through a function with a memory limit, on every download.
 */
export class DocumentsGroup extends HttpApiGroup.make("documents")
  .add(
    HttpApiEndpoint.get("register", "/documents")
      .addSuccess(Schema.Array(Responses.DocumentSummary))
      .addError(Failures.NotFound)
      .annotateContext(
        OpenApi.annotations({
          title: "The document register",
          description:
            "Every document with its matter and its current version — or, for " +
            "a signed-in client, the documents on their own matters. That is " +
            "the one genuinely new grant the portal has ever received; the " +
            "scope is what keeps them to their own file.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get(
      "forCase",
    )`/cases/${HttpApiSchema.param("caseId", CaseId)}/documents`
      .addSuccess(Schema.Array(Wire.Document))
      .addError(Failures.NotFound)
      .annotateContext(
        OpenApi.annotations({ title: "Documents on one matter" }),
      ),
  )
  .add(
    HttpApiEndpoint.get(
      "download",
    )`/documents/${HttpApiSchema.param("id", DocumentId)}/download`
      .addSuccess(Responses.Download)
      .addError(Failures.NotFound)
      .addError(Failures.StorageFailure)
      .annotateContext(
        OpenApi.annotations({
          title: "A signed URL for the current version",
          description:
            "Fifteen minutes. The URL *is* the authorisation once issued — a " +
            "CDN fetch carries no session — so it is deliberately short-lived " +
            "and `expiresAt` says when it stops working. The permission and " +
            "the scope are checked before it is minted, so it grants exactly " +
            "what the caller was already entitled to.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post(
      "markFiled",
    )`/documents/${HttpApiSchema.param("id", DocumentId)}/filed`
      .setPayload(Schema.Struct({}))
      .addSuccess(Wire.Document)
      .addError(Failures.NotFound)
      .addError(Failures.AlreadyFiled)
      .annotateContext(
        OpenApi.annotations({
          title: "Record a document as filed with the court",
          description:
            "The moment it becomes fixed: revising it is refused from here on. " +
            "There is deliberately no way to un-file — filing is a fact about " +
            "the world rather than a flag about this system, and a mistake is " +
            "corrected by saying so, not by making the record say it never " +
            "happened.",
        }),
      ),
  )
  .annotateContext(
    OpenApi.annotations({
      title: "Documents",
      description:
        "Versions are append-only, in the domain, in Postgres and in the blob " +
        "store. A pleading that was filed is evidence of what was said at that " +
        "moment.\n\n" +
        "Uploading is **not** here: bytes travel as multipart, which this " +
        "contract does not describe, and they arrive through a Server Action " +
        "instead. That is a real gap in the generated client and is stated " +
        "rather than papered over with a base64 field.",
    }),
  ) {}

// ── Work ──────────────────────────────────────────────────────────────────

/**
 * The firm's work list.
 *
 * **The split is done on the server, and that is the decision worth
 * defending.** `workList` could have been one array with a `dueOn` on each
 * task, leaving a client to filter. It is not, because the boundary between
 * "overdue" and "due soon" is the *start of a day* — a task due on the 20th is
 * not overdue at nine in the morning on the 20th — and a browser computing that
 * from its own clock would disagree with the server for every user outside UTC.
 * One reading, on the server, and three lists that are exhaustive and disjoint
 * by construction.
 *
 * `raise` and `complete` have opposite defaults about *who*, and both are
 * deliberate: the assignee is in the payload because work is given to a named
 * person, and the completer is not, because a completion recorded on somebody
 * else's behalf is a claim about them that they did not make.
 */
export class TasksGroup extends HttpApiGroup.make("tasks")
  .add(
    HttpApiEndpoint.get("workList", "/tasks")
      .addSuccess(Responses.WorkList)
      .annotateContext(
        OpenApi.annotations({
          title: "Everything outstanding",
          description:
            "Overdue, due within a week, and later — from one read and one " +
            "clock reading. `openCount` equals their combined length.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get(
      "forCase",
    )`/cases/${HttpApiSchema.param("caseId", CaseId)}/tasks`
      .addSuccess(Schema.Array(Responses.TaskSummary))
      .addError(Failures.NotFound)
      .annotateContext(
        OpenApi.annotations({
          title: "Work on one matter",
          description:
            "Completed tasks included, unlike the work list — a matter file " +
            "shows what was done as well as what is left.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("raise", "/tasks")
      .setPayload(Responses.RaiseTask)
      .addSuccess(Wire.Task)
      .addError(Failures.NotFound)
      .addError(Failures.MatterIsClosed)
      .addError(Failures.DueBeforeRaised)
      .annotateContext(
        OpenApi.annotations({
          title: "Raise a task",
          description:
            "`caseId` may be null: firm work — reconciling the trust " +
            "account — has no file number, and that is correct rather than a " +
            "gap. Compare a time entry, where the matter is required, because " +
            "unattributed time is a hole in the billing record.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post(
      "complete",
    )`/tasks/${HttpApiSchema.param("id", TaskId)}/completion`
      .setPayload(Schema.Struct({}))
      .addSuccess(Wire.Task)
      .addError(Failures.NotFound)
      .addError(Failures.AlreadyDone)
      .addError(Failures.NotAssignable)
      .annotateContext(
        OpenApi.annotations({
          title: "Mark a task done",
          description:
            "The payload is empty on purpose: who completed it is whoever is " +
            "signed in, never a field. A completion recorded on somebody " +
            "else's behalf is a claim about them that they did not make.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del(
      "reopen",
    )`/tasks/${HttpApiSchema.param("id", TaskId)}/completion`
      .addSuccess(Wire.Task)
      .addError(Failures.NotFound)
      .addError(Failures.NotDone)
      .addError(Failures.MatterIsClosed)
      .annotateContext(
        OpenApi.annotations({
          title: "Reopen a completed task",
          description:
            "A `DELETE` on the completion, because that is exactly what it " +
            "is — the record of who finished it and when is discarded, and " +
            "the task returns to `In progress` rather than `Not started`, " +
            "because somebody did think it was finished.\n\n" +
            "The discarded record survives only in the audit trail, which is " +
            "why both `task.completed` and `task.reopened` are written there.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post(
      "reassign",
    )`/tasks/${HttpApiSchema.param("id", TaskId)}/assignee`
      .setPayload(Responses.ReassignTask)
      .addSuccess(Wire.Task)
      .addError(Failures.NotFound)
      .addError(Failures.AlreadyDone)
      .annotateContext(
        OpenApi.annotations({
          title: "Hand a task to somebody else",
          description:
            "Its own operation and its own audit action rather than a general " +
            'amendment, because "who was this given to, and when did that ' +
            'change" is the question asked when a deadline is missed.\n\n' +
            "Finished work is refused: reassigning it changes nothing about " +
            "who did it, and would leave a completion naming one person under " +
            "an assignment naming another.",
        }),
      ),
  )
  .annotateContext(
    OpenApi.annotations({
      title: "Tasks",
      description:
        "The firm's work list. Two rules here are about a law firm rather " +
        "than about tasks: work cannot be raised on a closed matter, and a " +
        "matter cannot be *closed* over open work — the lifecycle endpoint " +
        "refuses that with `HasOpenTasks`. Closing does not delete tasks; it " +
        "removes them from every list a person looks at, which is how work " +
        "stops being done without anyone deciding against it.\n\n" +
        "There is no endpoint that edits a task's status directly. `Done` is " +
        "reached by completing and left by reopening, so the status and the " +
        "completion record cannot disagree.",
    }),
  ) {}

// ── Correspondence ────────────────────────────────────────────────────────

/**
 * Client messages.
 *
 * **The only group in this API a portal user may write to**, and the asymmetry
 * with documents is the argument for it. A message is text landing in a thread
 * the firm reads; nothing else acts on it. A document enters the matter *file*
 * — the thing that gets filed at court and relied on — and a file anybody may
 * add to needs a review step this system does not have.
 *
 * There is deliberately **no endpoint that edits or deletes a message**, for
 * either side. What was said to a client is part of the retainer's history; a
 * correction is a new message saying so. Postgres enforces the same thing with
 * a trigger, so a client is not relying on this API's good manners.
 *
 * `waiting` is the one endpoint here that is not about a thread. It answers
 * "which clients are waiting on us", which is *not* "which messages are
 * unread": a message somebody opened and did not answer is worse, because it
 * looks handled.
 */
export class MessagesGroup extends HttpApiGroup.make("messages")
  .add(
    HttpApiEndpoint.get(
      "thread",
    )`/clients/${HttpApiSchema.param("clientId", ClientId)}/messages`
      .addSuccess(Responses.Thread)
      .addError(Failures.NotFound)
      .annotateContext(
        OpenApi.annotations({
          title: "One client's correspondence",
          description:
            "Reading a thread **as a member of staff marks the client's " +
            "messages seen**; reading it as the client does not. That " +
            'asymmetry is deliberate: a single "mark this thread read" ' +
            "would let a client empty the firm's queue by refreshing the " +
            "page, and the waiting report would then be empty for exactly " +
            "the clients who were waiting.\n\n" +
            "`unread` is what was waiting when the thread was opened, so the " +
            "screen can say so after the marking has happened.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("waiting", "/messages/waiting")
      .addSuccess(Schema.Array(Responses.Waiting))
      .annotateContext(
        OpenApi.annotations({
          title: "Clients waiting on a reply",
          description:
            "One row per client, longest wait first, timed from when they " +
            "**first** asked — a run of chasing messages is one conversation " +
            "waiting, not three, and counting them separately would make a " +
            "queue of ten look like thirty.\n\n" +
            "`seen` distinguishes the two failures: not read at all, versus " +
            "read and not answered. The second is worse.\n\n" +
            "A portal user is answered with an empty list rather than a " +
            "refusal — a client has no queue of their own, and nothing is " +
            "being concealed.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("send", "/messages")
      .setPayload(Responses.SendMessage)
      .addSuccess(Wire.Message)
      .addError(Failures.NotFound)
      .addError(Failures.MatterIsNotTheirs)
      .annotateContext(
        OpenApi.annotations({
          title: "Send a message",
          description:
            "The author is whoever is signed in and is never in the payload: " +
            "a member of staff cannot send as a client, or as another " +
            "advocate. A message from the firm names the advocate who wrote " +
            "it; a message from a client names nobody, because the portal " +
            "login belongs to an organisation rather than a person.\n\n" +
            "`clientId` is required even for a portal user, whose scope makes " +
            "it redundant, so that one operation serves both sides. Naming " +
            "somebody else's thread is `NotFound`.",
        }),
      ),
  )
  .annotateContext(
    OpenApi.annotations({
      title: "Messages",
      description:
        "Append-only correspondence between a client and the firm. Both " +
        "sides are bound by the same rules — neither can edit or withdraw " +
        "what was said — which is the only arrangement a client has reason " +
        "to trust.",
    }),
  ) {}

// ── The session ───────────────────────────────────────────────────────────

/**
 * Who the caller is, and what they may do.
 *
 * One endpoint, and the browser needs it for something specific: the screens
 * decide what to *offer* from the same permission table the services enforce
 * with. A "Move to Closed" button rendered for a Receptionist and then refused
 * on click is a worse experience than one that was never drawn — and hiding it
 * without this would mean the browser holding its own copy of the table, which
 * is the copy that goes stale.
 *
 * `permissions` is the principal's own list and nobody else's, so it discloses
 * nothing: it is what the caller is about to find out by trying.
 */
export class SessionGroup extends HttpApiGroup.make("session")
  .add(
    HttpApiEndpoint.get("me", "/me")
      .addSuccess(Responses.Me)
      .annotateContext(
        OpenApi.annotations({
          title: "The signed-in principal",
          description:
            "Staff carry a role and an advocate id; a portal user carries a " +
            "client id and no role at all. The two are a tagged union rather " +
            "than one shape with optional fields, so a caller cannot read the " +
            "wrong half of it.",
        }),
      ),
  )
  .annotateContext(
    OpenApi.annotations({
      title: "Session",
      description:
        "Signing in and out are Better Auth's own endpoints under " +
        "/api/auth (ADR 0004) and are not described by this contract. This " +
        "group is what the application knows about whoever those endpoints " +
        "let in.",
    }),
  ) {}

// ── The API ───────────────────────────────────────────────────────────────

/**
 * Prefixed with `/api` because it is mounted inside Next's route tree, and the
 * request the route handler receives carries the whole pathname. The prefix
 * lives here rather than in the mount so that the derived client, the OpenAPI
 * servers block and the router all agree without anybody restating it.
 */
export class OkLawApi extends HttpApi.make("oklaw")
  .add(CasesGroup)
  .add(ClientsGroup)
  .add(BillingGroup)
  .add(TimeGroup)
  .add(HearingsGroup)
  .add(DocumentsGroup)
  .add(TasksGroup)
  .add(MessagesGroup)
  .add(SessionGroup)
  /**
   * Applied to the whole API rather than group by group.
   *
   * Every endpoint here runs as somebody, and the way to keep that true is for
   * it to be the default rather than a line each group has to remember. A
   * public endpoint, if there is ever one, becomes a visible exemption.
   */
  .middleware(Authentication)
  /**
   * Declared once, for the same reason. Every operation can be refused for want
   * of a permission, because every operation checks one — listing 403 on each
   * endpoint would be twelve copies of the same sentence, eleven of which stay
   * right when somebody edits the twelfth.
   */
  .addError(Failures.NotPermitted)
  .prefix("/api")
  .annotateContext(
    OpenApi.annotations({
      title: "OKLaw",
      version: "0.1.0",
      description:
        "A law-firm management system for a Kenyan practice.\n\n" +
        "Every refusal below is a rule with a citation behind it, not a " +
        "validation message: the Advocates Act on who may file, the " +
        "Magistrates' Courts Act on what a court may hear, the Advocates " +
        "(Accounts) Rules on client money. Each arrives as a tagged error " +
        "whose fields carry the specifics — the rank, the limit, the " +
        "advocate — so a caller can explain the refusal in its own words " +
        "rather than relaying a sentence chosen here.\n\n" +
        "Dates are ISO-8601. Money is integer cents of Kenyan shillings, " +
        "never a float: `420000000` is KES 4,200,000.00.",
    }),
  ) {}
