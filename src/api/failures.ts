import { HttpApiSchema } from "@effect/platform";
import type { Schema } from "effect";
import * as Billing from "../domain/billing/invoice";
import * as Matter from "../domain/case/case";
import * as Status from "../domain/case/status";
import * as Court from "../domain/court/court";
import * as Permissions from "../domain/identity/permissions";
import * as Ledger from "../domain/trust/ledger";
import * as BillingService from "../services/billing-service";
import * as ClientService from "../services/client-service";
import * as Hearing from "../domain/court/hearing";
import * as Documents from "../domain/document/document";
import * as DocumentService from "../services/document-service";
import * as TaskService from "../services/task-service";
import * as MessageService from "../services/message-service";
import * as Work from "../domain/work/task";
import * as HearingService from "../services/hearing-service";
import * as TimeService from "../services/time-service";
import * as CaseService from "../services/case-service";
import * as Policy from "../services/policy";
import * as Repositories from "../services/repositories";

/**
 * The refusals this API is willing to name, and the status codes they map to.
 *
 * Every one of these is a class the domain or the service layer already
 * defines. Nothing is re-declared: the schema on the wire *is* the schema the
 * rule failed with, which is what makes the generated client able to hand a
 * caller back the same `AdvocateMayNotFile` — `reason` getter and all — that
 * `CaseService` produced on the server.
 *
 * That is worth being explicit about, because it is the property the whole
 * phase is for. The sentence an advocate reads ("…the Advocates Act requires a
 * current practising certificate, and the record shows none for this year") is
 * never transmitted. It is a getter on a class, and both ends have the class,
 * so the wire carries `{ "_tag": "AdvocateMayNotFile", "name": …, "role": … }`
 * and the client reconstitutes the explanation. A hand-written API would have
 * put that sentence in the response body, and then in a second place when the
 * UI wanted to phrase it differently, and the two would drift.
 *
 * A consumer that is not this client — curl, another language — gets the tag
 * and the fields, which is the machine-readable half. The prose lives in the
 * OpenAPI description of each error instead, where a human reading the docs
 * page will actually find it.
 */

/**
 * Attaches a status code, leaving everything else about the schema alone.
 *
 * `HttpApiEndpoint.addError` also takes a status, but stating it there means
 * stating it once per endpoint that can fail this way — six copies of "422",
 * five of which stay right when somebody changes the sixth. Annotating the
 * error itself says it once, and the endpoints just list which failures they
 * have.
 */
const withStatus =
  (status: number, description: string) =>
  <A, I, R>(schema: Schema.Schema<A, I, R>): Schema.Schema<A, I, R> =>
    schema.annotations(HttpApiSchema.annotations<A>({ status, description }));

// ── 401 and 403: who is asking ────────────────────────────────────────────

export const NotAuthenticated = withStatus(
  401,
  "No session. Sign in at /sign-in; the session is a cookie, so a browser " +
    "needs no further arrangement and a script needs to keep the jar",
)(Policy.NotAuthenticated);

/**
 * 403, and deliberately terse about the reason.
 *
 * It names the role and the permission and stops there. Explaining *why* the
 * permission is not held — which roles hold it, what else it gates — would be
 * documenting the permission table to whoever just tried to step outside it.
 *
 * Note what is **not** here: there is no 403 for a portal user reaching another
 * client's matter. That is a 404, decided in `services/policy.ts`, because a
 * refusal that distinguishes "not yours" from "does not exist" tells the caller
 * the record exists — and for a law firm, the existence of a matter is itself
 * confidential.
 */
export const NotPermitted = withStatus(
  403,
  "The signed-in role does not hold the permission this operation requires. " +
    "Signing in again will not change it",
)(Permissions.NotPermitted);

// ── 404: it is not there ──────────────────────────────────────────────────

export const NotFound = withStatus(
  404,
  "No record with that id. The id is well-formed; nothing has it",
)(Repositories.NotFound);

// ── 409: the stored state conflicts with what was asked ───────────────────

export const InvalidTransition = withStatus(
  409,
  "The matter's current status does not permit this move. The permitted " +
    "moves are declared once, in the domain's transition table, and are " +
    "returned on the matter file as `mayBeMovedTo`",
)(Status.InvalidTransition);

export const CaseNumberTaken = withStatus(
  409,
  "Another intake claimed this matter reference first. References are " +
    "derived from what is already stored, so simultaneous intakes compute " +
    "the same one; the API retries three times before reporting this",
)(Repositories.CaseNumberTaken);

/**
 * Closing a matter that still has work on it.
 *
 * A 409 rather than a 422, because nothing about the request is wrong: the
 * matter's stored state conflicts with what was asked, and the same request
 * will succeed once the tasks are dealt with. `open` is on the wire because
 * "one forgotten item" and "fourteen" are different situations to the person
 * reading it.
 */
export const HasOpenTasks = withStatus(
  409,
  "The matter still has open tasks. Closing it would hide them from every " +
    "list in the system, which is how work stops being done without anyone " +
    "deciding against it",
)(CaseService.HasOpenTasks);

export const MatterReferencesExhausted = withStatus(
  409,
  "All 999 matter references for that year have been issued",
)(CaseService.MatterReferencesExhausted);

// ── 422: understood, and refused by a rule ────────────────────────────────

export const AdvocateNotInPractice = withStatus(
  422,
  "The assigned advocate is no longer active at the firm",
)(CaseService.AdvocateNotInPractice);

export const AdvocateMayNotFile = withStatus(
  422,
  "Advocates Act s. 9 and s. 31: only an advocate holding a current " +
    "practising certificate may file. Checked against today, and only when " +
    "the write is itself the act of filing",
)(CaseService.AdvocateMayNotFile);

export const OutsideCourtJurisdiction = withStatus(
  422,
  "Magistrates' Courts Act s. 7(1): the claim exceeds the pecuniary " +
    "jurisdiction of a court presided over by that rank of magistrate",
)(Court.OutsideCourtJurisdiction);

export const CannotFileWithoutValue = withStatus(
  422,
  "A matter with no recorded claim value cannot be checked against a " +
    "magistrates' court's pecuniary limit, and is refused rather than assumed " +
    "to be within it",
)(Matter.CannotFileWithoutValue);

export const FilingPrecedesIntake = withStatus(
  422,
  "The filing date is before the intake date. A file is opened before it is " +
    "filed",
)(Matter.FilingPrecedesIntake);

export const CauseNumberWithoutFiling = withStatus(
  422,
  "A cause number was supplied for a matter with no filing date. The court " +
    "assigns it on filing, so one without the other records something that " +
    "did not happen",
)(Matter.CauseNumberWithoutFiling);

export const IncompleteLimitation = withStatus(
  422,
  "The limitation clock needs both an accrual date and a basis. One alone " +
    "computes nothing and invites a later guess at the other",
)(Matter.IncompleteLimitation);

// ── Money ─────────────────────────────────────────────────────────────────

export const InvoiceNumberTaken = withStatus(
  409,
  "Another fee note claimed this number first. Numbers are derived from what " +
    "is already stored, so simultaneous writes compute the same one; the API " +
    "retries three times before reporting this",
)(Repositories.InvoiceNumberTaken);

export const InvoiceNumbersExhausted = withStatus(
  409,
  "All 9,999 fee-note numbers have been issued",
)(BillingService.InvoiceNumbersExhausted);

/**
 * 409 rather than 422, and the distinction is worth the sentence.
 *
 * A duplicate M-Pesa confirmation is not a malformed request — the payment is
 * perfectly well-formed and would be accepted on any other day. It conflicts
 * with the *stored state*: this confirmation has already been banked. That is
 * what 409 means, and it is the same reasoning that puts `CaseNumberTaken`
 * here rather than among the rule refusals below.
 */
export const PaymentAlreadyRecorded = withStatus(
  409,
  "This M-Pesa confirmation code has already been recorded against a fee " +
    "note. Recording it again would credit the client for money that arrived " +
    "once — the usual cause is the same confirmation SMS being forwarded twice",
)(Billing.PaymentAlreadyRecorded);

export const NothingOutstanding = withStatus(
  409,
  "The fee note has nothing outstanding, so there are no costs to transfer " +
    "out of client account against it",
)(BillingService.NothingOutstanding);

export const PaymentExceedsBalance = withStatus(
  422,
  "The payment is larger than the balance outstanding. Overpayment is a " +
    "representable state — `Overpaid` — but it is refused at the point of " +
    "entry, where it is nearly always a typo or a double-posted confirmation",
)(Billing.PaymentExceedsBalance);

/**
 * Rule 10, as a status code.
 *
 * 422 rather than 409: nothing about the stored state conflicts with the
 * request in the way a duplicate number does. The request is understood, and a
 * rule refuses it — the same shape as the Advocates Act refusals above. The
 * rule is that an advocate may not withdraw more than is held *for that
 * client*, and the error carries both figures so the caller can say so.
 */
export const TrustAccountUnderfunded = withStatus(
  422,
  "Advocates (Accounts) Rules r. 10: an advocate may not withdraw any sum in " +
    "excess of the amount held for the credit of that client. Note *that " +
    "client* — a firm holding millions across twenty clients may not pay out " +
    "against one whose own balance is short",
)(Ledger.TrustAccountUnderfunded);

// ── Time ──────────────────────────────────────────────────────────────────

/**
 * One entry, for one error.
 *
 * It was two — declared separately in the time and task services with the same
 * tag — and this table is where that showed up: an API cannot carry two
 * different schemas under one `_tag`, and a generated client branching on it
 * could not have told them apart. The error now lives in the domain and says
 * what was attempted; see `Matter.MatterIsClosed`.
 */
export const MatterIsClosed = withStatus(
  409,
  "The matter is closed, so it does not accrue time or carry work. " +
    "`attempted` says which was being tried. Reopening is a decision with " +
    "its own audit entry rather than a side effect of another screen",
)(Matter.MatterIsClosed);

export const BilledWorkIsFixed = withStatus(
  409,
  "The entry has already been carried onto a fee note. The client has been " +
    "billed for it as it stands, so editing it now would make the invoice and " +
    "the timesheet disagree about the same hours",
)(TimeService.BilledWorkIsFixed);

export const NotAFeeEarner = withStatus(
  422,
  "The signed-in principal has no fee-earner record, so time cannot be " +
    "attributed to them",
)(TimeService.NotAFeeEarner);

export const NothingToBill = withStatus(
  409,
  "The matter has no unbilled time recorded against it",
)(BillingService.NothingToBill);

/**
 * The double-billing guard, as a status code.
 *
 * 409, and it is the most literal conflict in this API: another fee note
 * claimed some of these hours between the read and the write. Nothing was
 * written — the transaction rolled back — and the two counts in the body are
 * what tell a caller that somebody else is billing this matter right now.
 */
export const TimeAlreadyBilled = withStatus(
  409,
  "Some of the matter's unbilled time was carried onto another fee note while " +
    "this one was being raised. Nothing has been written",
)(BillingService.TimeAlreadyBilled);

// ── Clients ───────────────────────────────────────────────────────────────

export const ClientNumbersExhausted = withStatus(
  409,
  "All 9,999 client numbers have been issued",
)(ClientService.ClientNumbersExhausted);

export const ContactsDoNotApply = withStatus(
  422,
  "Contacts belong to a corporate client. An individual gives instructions in " +
    "person, so there is nobody to name",
)(ClientService.ContactsDoNotApply);

// ── The court diary ───────────────────────────────────────────────────────

export const MatterNotOpen = withStatus(
  409,
  "The matter is not open, so it cannot be listed for hearing. If the court " +
    "has listed it, the matter should be reopened first",
)(HearingService.MatterNotOpen);

/**
 * 409, because what happened in court is a matter of record.
 *
 * Not 422: the request is perfectly well-formed, and would be accepted against
 * a hearing with no outcome. It conflicts with the stored state — this one has
 * already been recorded — and overwriting it would let the account of a day in
 * court be silently replaced.
 */
export const OutcomeAlreadyRecorded = withStatus(
  409,
  "This hearing's outcome is already recorded. What happened in court is not " +
    "overwritten; a correction is a deliberate act with a note",
)(HearingService.OutcomeAlreadyRecorded);

export const ListedInThePast = withStatus(
  422,
  "The date has already passed. A hearing listed behind today appears " +
    "immediately as a missed attendance, so this is refused — it is almost " +
    "always a mistyped year",
)(HearingService.ListedInThePast);

/**
 * The constraint that stops matters falling off the diary.
 *
 * An adjournment to a date at or before the hearing itself is always a typo,
 * usually a year entered wrong, and it would place the matter in the past where
 * no diary view surfaces it again.
 */
export const AdjournedIntoThePast = withStatus(
  422,
  "A hearing cannot be adjourned to a date at or before itself. Check the year",
)(Hearing.AdjournedIntoThePast);

// ── Documents ─────────────────────────────────────────────────────────────

/**
 * 409, because it conflicts with what is stored rather than with a rule about
 * the request: this document has been filed, and filed documents are fixed.
 */
export const CannotReviseFiledDocument = withStatus(
  409,
  "The document has been filed with the court. Filed documents are fixed — " +
    "the firm's copy and the court's copy differing under the same name is " +
    "worse than two clearly separate documents. A correction is a fresh " +
    "document",
)(Documents.CannotReviseFiledDocument);

export const AlreadyFiled = withStatus(
  409,
  "The document is already recorded as filed with the court",
)(DocumentService.AlreadyFiled);

export const NotAnUploader = withStatus(
  422,
  "The signed-in principal has no staff record, so an upload cannot be " +
    "attributed to them",
)(DocumentService.NotAnUploader);

/**
 * The blob store, not the database.
 *
 * Named rather than folded into a 500, and separate from `RepositoryFailure`
 * for the same reason it is separate in `services/`: "the database will not
 * answer" and "the blob store will not answer" are different operational
 * problems, and a caller that sees which one it was can decide whether
 * retrying is worth anything. It carries no detail beyond the operation —
 * a storage error can quote a key or a token, and neither belongs in a body.
 */
// ── Work ──────────────────────────────────────────────────────────────────

export const AlreadyDone = withStatus(
  409,
  "The task has already been completed. Completing it twice would overwrite " +
    "who finished it and when, which is the pair the record exists for",
)(Work.AlreadyDone);

export const NotDone = withStatus(
  409,
  "The task is not complete, so there is nothing to reopen",
)(Work.NotDone);

export const DueBeforeRaised = withStatus(
  422,
  "A task cannot be due before it was raised. This is almost always a " +
    "mistyped year, and the task would appear as overdue the moment it was " +
    "saved — noise in the one list that has to have none",
)(Work.DueBeforeRaised);

export const MatterIsNotTheirs = withStatus(
  422,
  "The matter named is not that client's. Filing a message against it would " +
    "put one client's matter in front of another, which is a disclosure " +
    "rather than a typo — so this is a refusal and not a `NotFound`: nothing " +
    "is being concealed from a sender who can see both",
)(Matter.MatterIsNotTheirs);

export const NotAssignable = withStatus(
  422,
  "Work is attributed to somebody on the staff list. A portal user and a " +
    "system administrator both have logins and neither carries a matter",
)(TaskService.NotAssignable);

export const StorageFailure = withStatus(
  502,
  "The document store did not answer. The document record is unaffected; " +
    "this is the CDN rather than the database",
)(Repositories.StorageFailure);
