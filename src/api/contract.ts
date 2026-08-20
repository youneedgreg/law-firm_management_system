import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi,
} from "@effect/platform";
import { Schema } from "effect";
import { CaseId, ClientId, InvoiceId } from "../domain/shared/ids";
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
 * There is deliberately **no `documents` group**, though the roadmap listed
 * one. Documents have a domain model and two tables and nothing in between —
 * no repository, no row↔domain mapping, nothing seeded, and no upload path
 * until Phase 7 wires Vercel Blob. Endpoints for it would return an empty array
 * from an empty table for as long as that is true. The whole argument for
 * generating a client from a contract is that the contract is *true*; shipping
 * one that is not, to fill in a checkbox, would spend the only thing this
 * design has going for it.
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
      .addError(Failures.CaseNumberTaken)
      .annotateContext(
        OpenApi.annotations({
          title: "Move a matter through the lifecycle",
          description:
            "The current status is read from storage rather than taken from " +
            "the request, so a stale client fails instead of overwriting. " +
            "Re-declaring the current status is refused rather than treated " +
            "as a no-op: it is almost always a double submit, and accepting " +
            "it would record that nothing happened.",
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
  .annotateContext(
    OpenApi.annotations({
      title: "Clients",
      description:
        "Individuals and corporate entities. Read-only: intake, contacts " +
        "and conflict screening are Phase 7.",
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
  .annotateContext(
    OpenApi.annotations({
      title: "Billing",
      description:
        "Fee notes. Totals and statuses are derived on every read and never " +
        "stored, so an invoice cannot disagree with its own lines.",
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
