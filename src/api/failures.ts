import { HttpApiSchema } from "@effect/platform";
import type { Schema } from "effect";
import * as Matter from "../domain/case/case";
import * as Status from "../domain/case/status";
import * as Court from "../domain/court/court";
import * as CaseService from "../services/case-service";
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
