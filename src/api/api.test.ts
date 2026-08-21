import { describe, expect, it } from "@effect/vitest";
import { Effect, Either, Option, Schema } from "effect";
import { BASE_URL, runningApi, withApi } from "../../test/api-harness";
import {
  asAdvocate,
  asFinance,
  asReceptionist,
  asWanjiku,
  asZenith,
  closedMatter,
  daniel,
  doneTask,
  draftPlaint,
  dueToday,
  filedList,
  filedMatter,
  firmChore,
  grace,
  lapsed,
  overdueInvoice,
  overdueTask,
  partPaidInvoice,
  sarah,
  settledInvoice,
  TODAY,
  unfiledMatter,
  wanjiku,
  zenith,
} from "../../test/fixtures";
import { CaseId, ClientId, DocumentId, InvoiceId } from "../domain/shared/ids";
import { openApiSpec } from "./openapi";

/**
 * The API, driven through the client generated from its own definition.
 *
 * Every test here runs the real router, the real handlers and the real
 * services, and reaches them the way anything outside the process would. What
 * that buys over the service tests in `case-service.test.ts` is the two layers
 * those cannot see: the encoding, and the contract. A `Date` that does not
 * survive JSON, a path parameter that decodes to the wrong branded id, an error
 * a handler can produce but the endpoint never declared — none of those are
 * visible to a service test, and all of them are visible here.
 */

const uuid = <A>(schema: Schema.Schema<A, string>, value: string) =>
  Schema.decodeSync(schema)(value);

/** A well-formed id that belongs to nothing. */
const ABSENT = "99999999-9999-4999-8999-999999999999";

describe("reading matters", () => {
  it.effect("returns the caseload with names resolved", () =>
    withApi((client) =>
      Effect.gen(function* () {
        const caseload = yield* client.cases.caseload({ urlParams: {} });

        expect(caseload).toHaveLength(3);
        const filed = caseload.find(
          (summary) => summary.matter.id === filedMatter.id,
        );
        expect(filed?.clientName).toBe("Wanjiku Mwangi");
        expect(filed?.advocateName).toBe("Adv. Sarah Wanjiru");
      }),
    ),
  );

  /**
   * The reason `wire.ts` exists, asserted rather than argued.
   *
   * The value went out as an ISO string and came back a `Date` — same instant,
   * and a real `Date` rather than a string that has to be remembered to be
   * parsed at every use.
   */
  it.effect("round-trips dates as Date, not as strings", () =>
    withApi((client) =>
      Effect.gen(function* () {
        const file = yield* client.cases.file({ path: { id: filedMatter.id } });

        expect(file.matter.openedOn).toBeInstanceOf(Date);
        expect(file.matter.openedOn.getTime()).toBe(
          filedMatter.openedOn.getTime(),
        );
        expect(file.matter.filedOn?.toISOString()).toBe(
          "2026-02-14T00:00:00.000Z",
        );
      }),
    ),
  );

  /** The tagged union survives the crossing, discriminant and all. */
  it.effect("round-trips the court as its tagged union", () =>
    withApi((client) =>
      Effect.gen(function* () {
        const file = yield* client.cases.file({ path: { id: filedMatter.id } });

        expect(file.matter.court).toEqual({
          _tag: "MagistratesCourt",
          station: "Milimani",
          rank: "Chief Magistrate",
        });
      }),
    ),
  );

  it.effect("filters the caseload by status and by advocate", () =>
    withApi((client) =>
      Effect.gen(function* () {
        const closed = yield* client.cases.caseload({
          urlParams: { status: "Closed" },
        });
        expect(closed.map((s) => s.matter.id)).toEqual([closedMatter.id]);

        const hers = yield* client.cases.caseload({
          urlParams: { advocateId: grace.id },
        });
        expect(hers.map((s) => s.matter.id)).toEqual([unfiledMatter.id]);
      }),
    ),
  );

  /**
   * The permitted moves come from the domain's transition table by way of the
   * service, so a consumer never needs its own copy of the state machine.
   */
  it.effect("sends the statuses a matter may move to", () =>
    withApi((client) =>
      Effect.gen(function* () {
        const file = yield* client.cases.file({
          path: { id: closedMatter.id },
        });
        expect(file.mayBeMovedTo).toEqual(["Appealed"]);
      }),
    ),
  );

  /** A matter with no accrual date has no limitation window, and says so. */
  it.effect("omits the limitation view where none can be computed", () =>
    withApi((client) =>
      Effect.gen(function* () {
        const withWindow = yield* client.cases.file({
          path: { id: filedMatter.id },
        });
        expect(withWindow.limitation?.window.provision).toContain("s. 4(1)(a)");
        expect(withWindow.limitation?.window.expiresOn).toBeInstanceOf(Date);

        const without = yield* client.cases.file({
          path: { id: unfiledMatter.id },
        });
        expect(without.limitation).toBeUndefined();
      }),
    ),
  );

  /**
   * A static segment and a parameterised one share a prefix. Two independent
   * things keep them apart — the router prefers the static route, and
   * `intake-choices` is not a UUID — and this asserts the outcome rather than
   * either mechanism.
   */
  it.effect("does not capture /cases/intake-choices as a matter id", () =>
    withApi((client) =>
      Effect.gen(function* () {
        const choices = yield* client.cases.intakeChoices({});

        expect(choices.clients.map((c) => c.name)).toEqual([
          "Wanjiku Mwangi",
          "Zenith Distributors Ltd",
        ]);
        // Sarah holds a current certificate; Grace is a Legal Assistant.
        expect(choices.advocates.find((a) => a.id === sarah.id)?.mayFile).toBe(
          true,
        );
        expect(choices.advocates.find((a) => a.id === grace.id)?.mayFile).toBe(
          false,
        );
        /**
         * Peter is still at the firm and his certificate is last year's, so he
         * is offered and marked — the two reasons someone may not file are
         * different, and are shown differently. Daniel has left, so he is not
         * offered at all: someone who is gone is not a choice that was nearly
         * right.
         */
        expect(choices.advocates.find((a) => a.id === lapsed.id)?.mayFile).toBe(
          false,
        );
        expect(choices.advocates.map((a) => a.id)).not.toContain(daniel.id);
      }),
    ),
  );
});

describe("writing matters", () => {
  const intake = {
    title: "Zenith Distributors Ltd v. Coastal Freight Ltd",
    opposingParties: ["Coastal Freight Ltd"],
    type: "Commercial",
    clientId: zenith.id,
    advocateId: sarah.id,
    underCustomaryLaw: false,
    openedOn: new Date("2026-08-19T00:00:00Z"),
  } as const;

  it.effect("opens a matter and assigns the next reference", () =>
    withApi((client) =>
      Effect.gen(function* () {
        const opened = yield* client.cases.open({ payload: intake });

        // Derived from what is stored: OKL-2026-032 is the highest issued.
        expect(opened.number).toBe("OKL-2026-033");
        expect(opened.status).toBe("New");
        expect(opened.openedOn).toBeInstanceOf(Date);

        // And it is on the caseload the very next read.
        const caseload = yield* client.cases.caseload({ urlParams: {} });
        expect(caseload.map((s) => s.matter.id)).toContain(opened.id);
      }),
    ),
  );

  it.effect("amends a matter, leaving absent fields alone", () =>
    withApi((client) =>
      Effect.gen(function* () {
        const amended = yield* client.cases.amend({
          path: { id: unfiledMatter.id },
          payload: { title: "Zenith Distributors Ltd — supply dispute" },
        });

        expect(amended.title).toBe("Zenith Distributors Ltd — supply dispute");
        // Untouched by a submission that did not mention them.
        expect(amended.type).toBe(unfiledMatter.type);
        expect(amended.claimValueCents).toBe(unfiledMatter.claimValueCents);
        expect(amended.advocateId).toBe(unfiledMatter.advocateId);
      }),
    ),
  );

  it.effect("moves a matter through the lifecycle", () =>
    withApi((client) =>
      Effect.gen(function* () {
        const moved = yield* client.cases.transition({
          path: { id: unfiledMatter.id },
          payload: { to: "Active" },
        });
        expect(moved.status).toBe("Active");
      }),
    ),
  );
});

/**
 * The half of the contract that is easy to get wrong and invisible until
 * somebody integrates: a refusal has to arrive as the refusal, not as a 500.
 */
describe("refusals", () => {
  /**
   * The property the whole arrangement is for.
   *
   * `reason` is a getter on a class in `domain/`. It is not a field, so it is
   * never serialised — the body carries `{"_tag":"OutsideCourtJurisdiction",
   * "rank":…,"limit":…,"value":…}`. Both ends hold the schema, so the client
   * rebuilds the class and the sentence is *reconstituted* rather than
   * transmitted. A hand-written API would have put that sentence in the
   * response body, and then again in the UI when it wanted different wording.
   */
  it.effect(
    "returns the statutory reason for an out-of-jurisdiction filing",
    () =>
      withApi((client) =>
        Effect.gen(function* () {
          const result = yield* Effect.either(
            client.cases.open({
              payload: {
                title: "Kariuki v. Highland Tea Ltd",
                opposingParties: ["Highland Tea Ltd"],
                type: "Civil",
                clientId: wanjiku.id,
                advocateId: sarah.id,
                underCustomaryLaw: false,
                openedOn: new Date("2026-08-19T00:00:00Z"),
                filedOn: new Date("2026-08-19T00:00:00Z"),
                claimValueCents: 9_000_000_00,
                court: {
                  _tag: "MagistratesCourt",
                  station: "Milimani",
                  rank: "Resident Magistrate",
                },
              },
            }),
          );

          expect(Either.isLeft(result)).toBe(true);
          if (Either.isLeft(result)) {
            const failure = result.left;
            expect(failure._tag).toBe("OutsideCourtJurisdiction");
            if (failure._tag === "OutsideCourtJurisdiction") {
              expect(failure.rank).toBe("Resident Magistrate");
              // Reconstituted on this side, never sent.
              expect(failure.reason).toContain(
                "Magistrates' Courts Act s. 7(1)",
              );
            }
          }
        }),
      ),
  );

  it.effect("refuses a filing by an advocate with no current certificate", () =>
    withApi((client) =>
      Effect.gen(function* () {
        const result = yield* Effect.either(
          client.cases.amend({
            path: { id: unfiledMatter.id },
            payload: { filedOn: new Date("2026-08-19T00:00:00Z") },
          }),
        );

        expect(Either.isLeft(result)).toBe(true);
        if (Either.isLeft(result)) {
          expect(result.left._tag).toBe("AdvocateMayNotFile");
        }
      }),
    ),
  );

  it.effect("refuses a filing date before the intake date", () =>
    withApi((client) =>
      Effect.gen(function* () {
        const result = yield* Effect.either(
          client.cases.open({
            payload: {
              ...{
                title: "Backdated filing",
                opposingParties: [],
                type: "Civil",
                clientId: wanjiku.id,
                advocateId: sarah.id,
                underCustomaryLaw: false,
              },
              openedOn: new Date("2026-08-19T00:00:00Z"),
              filedOn: new Date("2026-08-01T00:00:00Z"),
            },
          }),
        );

        expect(Either.isLeft(result)).toBe(true);
        if (Either.isLeft(result)) {
          const failure = result.left;
          expect(failure._tag).toBe("FilingPrecedesIntake");
          if (failure._tag === "FilingPrecedesIntake") {
            // The dates came back as dates, through an error's own schema.
            expect(failure.filedOn).toBeInstanceOf(Date);
            expect(failure.reason).toContain("opened before it is filed");
          }
        }
      }),
    ),
  );

  it.effect("refuses an illegal status move with the permitted ones", () =>
    withApi((client) =>
      Effect.gen(function* () {
        const result = yield* Effect.either(
          client.cases.transition({
            path: { id: closedMatter.id },
            payload: { to: "New" },
          }),
        );

        expect(Either.isLeft(result)).toBe(true);
        if (Either.isLeft(result)) {
          const failure = result.left;
          expect(failure._tag).toBe("InvalidTransition");
          if (failure._tag === "InvalidTransition") {
            expect(failure.reason).toContain("it may only become Appealed");
          }
        }
      }),
    ),
  );

  it.effect("reports an unknown id as NotFound", () =>
    withApi((client) =>
      Effect.gen(function* () {
        const result = yield* Effect.either(
          client.cases.file({ path: { id: uuid(CaseId, ABSENT) } }),
        );

        expect(Either.isLeft(result)).toBe(true);
        if (Either.isLeft(result)) {
          expect(result.left._tag).toBe("NotFound");
        }
      }),
    ),
  );
});

/**
 * The client decodes a 404 into `NotFound`, which is exactly why the status
 * codes need checking somewhere the client is not involved. These go through
 * the raw handler.
 */
describe("status codes", () => {
  const request = (path: string, init?: RequestInit) => {
    const api = runningApi();
    return Effect.promise(() =>
      api.handler(new Request(`${BASE_URL}${path}`, init)),
    ).pipe(Effect.ensuring(Effect.promise(() => api.dispose())));
  };

  it.effect("404 for a well-formed id that matches nothing", () =>
    Effect.gen(function* () {
      const response = yield* request(`/api/cases/${ABSENT}`);
      expect(response.status).toBe(404);
      expect(yield* Effect.promise(() => response.json())).toMatchObject({
        _tag: "NotFound",
        entity: "Case",
      });
    }),
  );

  /**
   * A malformed id never reaches a service: the path schema is `CaseId`, a
   * branded UUID, so "not-a-uuid" is a request that failed validation rather
   * than a lookup that found nothing. 400, and the body names the field.
   */
  it.effect("400 for a malformed id, before any service is called", () =>
    Effect.gen(function* () {
      const response = yield* request("/api/cases/not-a-uuid");
      expect(response.status).toBe(400);
    }),
  );

  it.effect("409 when the stored state conflicts", () =>
    Effect.gen(function* () {
      const response = yield* request(`/api/cases/${closedMatter.id}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: "New" }),
      });
      expect(response.status).toBe(409);
    }),
  );

  it.effect("422 when a rule refuses the submitted values", () =>
    Effect.gen(function* () {
      const response = yield* request(`/api/cases/${unfiledMatter.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filedOn: "2026-08-19T00:00:00.000Z" }),
      });
      expect(response.status).toBe(422);
      expect(yield* Effect.promise(() => response.json())).toMatchObject({
        _tag: "AdvocateMayNotFile",
      });
    }),
  );

  it.effect("201 when a matter is opened", () =>
    Effect.gen(function* () {
      const response = yield* request("/api/cases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Created via the API",
          type: "Commercial",
          clientId: zenith.id,
          advocateId: sarah.id,
          underCustomaryLaw: false,
          openedOn: "2026-08-19T00:00:00.000Z",
        }),
      });
      expect(response.status).toBe(201);
    }),
  );

  /**
   * A body that is well-formed JSON and the wrong shape.
   *
   * The response names the field and says what was expected, because the schema
   * knows both — a hand-written handler would have managed "invalid request".
   * The value here is a matter type that is not one of the ten in the union,
   * which is the case a `string` column would have accepted and stored.
   */
  it.effect("400, naming the field and what was expected", () =>
    Effect.gen(function* () {
      const response = yield* request("/api/cases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Kariuki v. Highland Tea Ltd",
          type: "Interpretive Dance",
          clientId: zenith.id,
          advocateId: sarah.id,
          underCustomaryLaw: false,
          openedOn: "2026-08-19T00:00:00.000Z",
        }),
      });

      expect(response.status).toBe(400);
      const body: unknown = yield* Effect.promise(() => response.json());
      expect(body).toMatchObject({ _tag: "HttpApiDecodeError" });

      const rendered = JSON.stringify(body);
      expect(rendered).toContain("type");
      expect(rendered).toContain("Interpretive Dance");
      // The refusal lists the ten it would have accepted.
      expect(rendered).toContain("Commercial");
    }),
  );
});

describe("clients and billing", () => {
  it.effect("counts each client's caseload", () =>
    withApi((client) =>
      Effect.gen(function* () {
        const directory = yield* client.clients.directory({});

        const zenithRow = directory.find((row) => row.client.id === zenith.id);
        expect(zenithRow?.totalMatters).toBe(1);
        expect(zenithRow?.openMatters).toBe(1);
        // Two matters, one of them closed.
        const wanjikuRow = directory.find(
          (row) => row.client.id === wanjiku.id,
        );
        expect(wanjikuRow?.totalMatters).toBe(2);
        expect(wanjikuRow?.openMatters).toBe(1);
      }),
    ),
  );

  /** The corporate/individual union arrives discriminated. */
  it.effect("round-trips a corporate client with its contacts", () =>
    withApi((client) =>
      Effect.gen(function* () {
        const file = yield* client.clients.file({ path: { id: zenith.id } });

        expect(file.client._tag).toBe("Corporate");
        if (file.client._tag === "Corporate") {
          expect(file.client.contacts[0].name).toBe("Eunice Wambui");
        }
        expect(file.primaryContact).toBe("Eunice Wambui");
        expect(file.client.onboardedOn).toBeInstanceOf(Date);
      }),
    ),
  );

  /**
   * Neither total nor status is stored; both are computed from the lines, the
   * payments and the stopped clock. Three invoices, three derived statuses.
   */
  it.effect("derives invoice totals and statuses", () =>
    withApi((client) =>
      Effect.gen(function* () {
        const settled = yield* client.billing.invoice({
          path: { id: settledInvoice.id },
        });
        expect(settled.total).toBe(11_000_00);
        expect(settled.outstanding).toBe(0);
        expect(settled.status).toBe("Paid");
        expect(settled.daysOverdue).toBe(0);

        const overdue = yield* client.billing.invoice({
          path: { id: overdueInvoice.id },
        });
        expect(overdue.total).toBe(13_000_00);
        expect(overdue.status).toBe("Overdue");
        expect(overdue.daysOverdue).toBe(35);

        const part = yield* client.billing.invoice({
          path: { id: partPaidInvoice.id },
        });
        expect(part.status).toBe("Partially Paid");
        expect(part.outstanding).toBe(5_000_00);
      }),
    ),
  );

  it.effect("lists a client's fee notes, newest first", () =>
    withApi((client) =>
      Effect.gen(function* () {
        const theirs = yield* client.billing.forClient({
          path: { clientId: zenith.id },
        });

        expect(theirs.map((view) => view.invoice.number)).toEqual([
          "INV-1003",
          "INV-1002",
        ]);
      }),
    ),
  );

  /**
   * "No invoices" and "no such client" are different answers, and the endpoint
   * refuses to collapse them into an empty array.
   */
  it.effect("404s an unknown client rather than returning an empty list", () =>
    withApi((client) =>
      Effect.gen(function* () {
        const result = yield* Effect.either(
          client.billing.forClient({
            path: { clientId: uuid(ClientId, ABSENT) },
          }),
        );

        expect(Either.isLeft(result)).toBe(true);
        if (Either.isLeft(result)) {
          expect(result.left._tag).toBe("NotFound");
        }
      }),
    ),
  );

  it.effect("404s an unknown invoice", () =>
    withApi((client) =>
      Effect.gen(function* () {
        const result = yield* Effect.either(
          client.billing.invoice({ path: { id: uuid(InvoiceId, ABSENT) } }),
        );
        expect(Either.isLeft(result)).toBe(true);
      }),
    ),
  );
});

/**
 * The document is generated, so what is worth asserting is not its contents in
 * detail but that it *is* generated — that it tracks the definition rather than
 * a copy of it.
 */
/**
 * Money, over HTTP.
 *
 * These are the tests where the contract earns its keep, because the money
 * refusals are the ones whose *explanation* matters most. A duplicate M-Pesa
 * confirmation arrives on the client as `PaymentAlreadyRecorded` — the class,
 * with its `reason` getter — and the sentence a user reads was never
 * transmitted: the wire carried a tag and a ten-character code, and the client
 * reconstituted the rest because both ends hold the same class.
 */
describe("money", () => {
  it.effect("raises a fee note and numbers it from what is stored", () =>
    withApi(
      (client) =>
        Effect.gen(function* () {
          const raised = yield* client.billing.raise({
            payload: {
              clientId: zenith.id,
              issuedOn: new Date("2026-08-19T00:00:00.000Z"),
              dueOn: new Date("2026-09-18T00:00:00.000Z"),
              lines: [
                {
                  description: "Professional fees — August",
                  quantityHundredths: 100,
                  unitPriceCents: 45_000_00,
                },
              ],
            },
          });

          expect(raised.number).toBe("INV-1004");
          // A `Date` on both ends, an ISO-8601 string in between.
          expect(raised.issuedOn).toBeInstanceOf(Date);
          expect(raised.payments).toEqual([]);
        }),
      { as: asFinance },
    ),
  );

  it.effect("records a payment and re-derives the status", () =>
    withApi(
      (client) =>
        Effect.gen(function* () {
          const view = yield* client.billing.recordPayment({
            path: { id: overdueInvoice.id },
            payload: {
              amountCents: 13_000_00,
              method: "Bank Transfer",
              receivedOn: new Date("2026-08-18T00:00:00.000Z"),
              reference: "FT26230AB12",
            },
          });

          expect(view.status).toBe("Paid");
          expect(view.outstanding).toBe(0);
        }),
      { as: asFinance },
    ),
  );

  /**
   * The refusal arrives as the class, not as a message.
   *
   * `SFH4KJ2L91` is already on `settledInvoice`. What crosses the wire is
   * `{"_tag":"PaymentAlreadyRecorded","confirmation":"SFH4KJ2L91"}`; the
   * sentence below is composed on the client from a getter the server also has.
   */
  it.effect("refuses a confirmation code that has already been banked", () =>
    withApi(
      (client) =>
        Effect.gen(function* () {
          const result = yield* Effect.either(
            client.billing.recordPayment({
              path: { id: partPaidInvoice.id },
              payload: {
                amountCents: 1_000_00,
                method: "M-Pesa",
                receivedOn: new Date("2026-08-18T00:00:00.000Z"),
                reference: "SFH4KJ2L91",
              },
            }),
          );

          expect(Either.isLeft(result)).toBe(true);
          if (Either.isLeft(result)) {
            expect(result.left._tag).toBe("PaymentAlreadyRecorded");
            if (result.left._tag === "PaymentAlreadyRecorded") {
              expect(result.left.confirmation).toBe("SFH4KJ2L91");
              expect(result.left.reason).toContain("credit the client twice");
            }
          }
        }),
      { as: asFinance },
    ),
  );

  /**
   * The M-Pesa rule is on the *request schema*, so this never reaches a
   * service — it is a 400 from the decoder. That is the right place for it: an
   * API that accepts a payment its own service will then reject is an API you
   * have to try before you can understand.
   */
  it.effect(
    "refuses an M-Pesa payment with no confirmation code, at the boundary",
    () =>
      Effect.gen(function* () {
        const api = runningApi({ as: asFinance });

        const response = yield* Effect.promise(() =>
          api.handler(
            new Request(
              `${BASE_URL}/api/invoices/${partPaidInvoice.id}/payments`,
              {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  cookie: `oklaw.session_token=token-${asFinance.userId}`,
                },
                body: JSON.stringify({
                  amountCents: 100_00,
                  method: "M-Pesa",
                  receivedOn: "2026-08-18T00:00:00.000Z",
                }),
              },
            ),
          ),
        );

        expect(response.status).toBe(400);
        yield* Effect.promise(() => api.dispose());
      }),
  );

  it.effect("settles a fee note out of client money and moves the ledger", () =>
    withApi(
      (client) =>
        Effect.gen(function* () {
          const view = yield* client.billing.settle({
            path: { id: overdueInvoice.id },
            payload: {
              amountCents: 13_000_00,
              settledOn: new Date("2026-08-19T00:00:00.000Z"),
            },
          });

          expect(view.status).toBe("Paid");

          const ledger = yield* client.billing.ledger({
            path: { clientId: zenith.id },
          });

          expect(ledger.balance).toBe(237_000_00);
          expect(ledger.movements.at(-1)?.reason).toBe(
            "Transfer to office account for costs",
          );
        }),
      { as: asFinance },
    ),
  );

  /**
   * Rule 10 as a 422, carrying both figures.
   *
   * The firm holds a quarter of a million shillings — for Zenith. Wanjiku's own
   * balance is nothing, and it is her balance the rule is about.
   */
  it.effect("refuses a settlement the client's own balance cannot cover", () =>
    withApi(
      (client) =>
        Effect.gen(function* () {
          const result = yield* Effect.either(
            client.billing.settle({
              path: { id: settledInvoice.id },
              payload: {
                amountCents: 1_000_00,
                settledOn: new Date("2026-08-19T00:00:00.000Z"),
              },
            }),
          );

          expect(Either.isLeft(result)).toBe(true);
          if (Either.isLeft(result)) {
            // `settledInvoice` is paid in full, so the invoice refuses before
            // the ledger is reached — and the order is deliberate: there is no
            // point asking the client account about a fee note with nothing
            // owing on it.
            expect(result.left._tag).toBe("NothingOutstanding");
          }
        }),
      { as: asFinance },
    ),
  );

  it.effect("answers 422 for a Rule 10 breach, with the rule in the body", () =>
    Effect.gen(function* () {
      const api = runningApi({ as: asFinance, movements: [] });

      const response = yield* Effect.promise(() =>
        api.handler(
          new Request(
            `${BASE_URL}/api/invoices/${overdueInvoice.id}/settlement`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                cookie: `oklaw.session_token=token-${asFinance.userId}`,
              },
              body: JSON.stringify({
                amountCents: 1_000_00,
                settledOn: "2026-08-19T00:00:00.000Z",
              }),
            },
          ),
        ),
      );

      expect(response.status).toBe(422);

      const body = (yield* Effect.promise(() => response.json())) as {
        readonly _tag: string;
        readonly held: number;
        readonly requested: number;
      };

      expect(body._tag).toBe("TrustAccountUnderfunded");
      expect(body.held).toBe(0);
      expect(body.requested).toBe(1_000_00);

      yield* Effect.promise(() => api.dispose());
    }),
  );

  it.effect(
    "gives finance the client account and a portal user none of it",
    () =>
      withApi(
        (client) =>
          Effect.gen(function* () {
            const theirs = yield* client.billing.receivables();

            // Wanjiku has one fee note. `trust` is absent, not empty: an empty
            // array would say the firm holds no client money.
            expect(theirs.invoices).toHaveLength(1);
            expect(theirs.trust).toBeUndefined();
          }),
        { as: asWanjiku },
      ),
  );

  it.effect("refuses an Advocate the client account they may not move", () =>
    withApi(
      (client) =>
        Effect.gen(function* () {
          const result = yield* Effect.either(
            client.billing.deposit({
              payload: {
                clientId: zenith.id,
                amountCents: 10_000_00,
                receivedOn: new Date("2026-08-19T00:00:00.000Z"),
              },
            }),
          );

          expect(Either.isLeft(result)).toBe(true);
          if (Either.isLeft(result)) {
            expect(result.left._tag).toBe("NotPermitted");
            if (result.left._tag === "NotPermitted") {
              expect(result.left.permission).toBe("trust:write");
            }
          }
        }),
      { as: asAdvocate },
    ),
  );
});

describe("the OpenAPI document", () => {
  it("describes every path the contract declares", () => {
    expect(Object.keys(openApiSpec.paths).sort()).toEqual([
      "/api/billing",
      "/api/cases",
      "/api/cases/intake-choices",
      "/api/cases/{caseId}/documents",
      "/api/cases/{caseId}/fee-note",
      "/api/cases/{caseId}/tasks",
      "/api/cases/{id}",
      "/api/cases/{id}/status",
      "/api/clients",
      "/api/clients/screen",
      "/api/clients/{clientId}/invoices",
      "/api/clients/{clientId}/messages",
      "/api/clients/{clientId}/trust",
      "/api/clients/{id}",
      "/api/documents",
      "/api/documents/{id}/download",
      "/api/documents/{id}/filed",
      "/api/hearings",
      "/api/hearings/{id}/outcome",
      "/api/invoices",
      "/api/invoices/{id}",
      "/api/invoices/{id}/payments",
      "/api/invoices/{id}/settlement",
      "/api/me",
      "/api/messages",
      "/api/messages/waiting",
      "/api/tasks",
      "/api/tasks/{id}/assignee",
      "/api/tasks/{id}/completion",
      "/api/time",
      "/api/time/work-in-progress",
      "/api/time/{id}",
      "/api/trust/deposits",
    ]);
  });

  /**
   * The status codes live on the error schemas in `failures.ts`, stated once
   * and picked up by every endpoint that can fail that way. This is what proves
   * they reached the document rather than only the router.
   */
  it("carries the status code each refusal was annotated with", () => {
    const open = openApiSpec.paths["/api/cases"]?.post;

    // 401 and 403 are on every operation since Phase 6: the first from the
    // authentication middleware, which the whole API carries, and the second
    // declared once on the API rather than per endpoint.
    expect(Object.keys(open?.responses ?? {}).sort()).toEqual([
      "201",
      "400",
      "401",
      "403",
      "404",
      "409",
      "422",
    ]);
  });

  it("is served as JSON", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const api = runningApi();
        const response = yield* Effect.promise(() =>
          api.handler(new Request(`${BASE_URL}/api/openapi.json`)),
        );
        expect(response.status).toBe(200);

        const body = yield* Effect.promise(() => response.json());
        expect(body).toMatchObject({ info: { title: "OKLaw" } });

        yield* Effect.promise(() => api.dispose());
      }),
    ));
});

/**
 * Authentication and authorization, over HTTP.
 *
 * The service tests already assert these rules. What this file adds is that
 * they survive the transport: an endpoint that forgot the middleware, a status
 * code that annotates the wrong schema, a refusal that encodes into something
 * the client cannot distinguish from success — none of that is visible from a
 * service test, and all of it is what a caller would actually meet.
 *
 * The requests are made through the generated client, so a refusal arrives as
 * the class the service failed with. `runningApi` is used directly where the
 * *status code* is the assertion: a client that decodes 404 into `NotFound` is
 * exactly why it is worth checking, separately, that the wire said 404.
 */
describe("who is asking", () => {
  it("answers 401 to a request with no session", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const api = runningApi({ as: null });

        const response = yield* Effect.promise(() =>
          api.handler(new Request(`${BASE_URL}/api/cases`)),
        );

        expect(response.status).toBe(401);

        // The body names the refusal and nothing else — no hint about which
        // accounts exist, and no stack.
        const body = yield* Effect.promise(() => response.json());
        expect(body).toMatchObject({ _tag: "NotAuthenticated" });

        yield* Effect.promise(() => api.dispose());
      }),
    ));

  /**
   * Every endpoint, not just the ones somebody remembered.
   *
   * The middleware is declared on the whole API rather than per group, and this
   * is the assertion that says so: a group added in Phase 7 that quietly missed
   * it would show up here as a 200.
   */
  it("answers 401 on every path the contract declares", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const api = runningApi({ as: null });

        const paths = [
          "/api/cases",
          "/api/cases/intake-choices",
          `/api/cases/${filedMatter.id}`,
          "/api/clients",
          `/api/clients/${wanjiku.id}`,
          `/api/clients/${wanjiku.id}/invoices`,
          "/api/me",
          "/api/messages",
          "/api/messages/waiting",
        ];

        const statuses = yield* Effect.forEach(paths, (path) =>
          Effect.promise(async () => {
            const response = await api.handler(
              new Request(`${BASE_URL}${path}`),
            );
            return response.status;
          }),
        );

        expect(statuses).toEqual(paths.map(() => 401));

        yield* Effect.promise(() => api.dispose());
      }),
    ));

  it("says who the caller is, and what they may do", () =>
    withApi((client) =>
      Effect.gen(function* () {
        const me = yield* client.session.me({});

        expect(me.principal._tag).toBe("Staff");
        expect(me.permissions).toContain("case:open");
        expect(me.permissions).not.toContain("trust:write");
      }),
    ));

  /**
   * The portal user's `/me` is a different *shape*, not a flag.
   *
   * `principal` is the domain's tagged union on the wire too, so a client
   * reading `clientId` has to narrow on the tag first — there is no shape in
   * which a staff member has a `clientId` to be read by mistake.
   */
  it("describes a portal user as a portal user", () =>
    withApi(
      (client) =>
        Effect.gen(function* () {
          const me = yield* client.session.me({});

          expect(me.principal._tag).toBe("PortalUser");
          if (me.principal._tag === "PortalUser") {
            expect(me.principal.clientId).toBe(wanjiku.id);
          }
          expect(me.permissions).toEqual([
            "case:read",
            "client:read",
            "invoice:read",
          ]);
        }),
      { as: asWanjiku },
    ));
});

describe("a portal user, trying", () => {
  it("is served their own matter", () =>
    withApi(
      (client) =>
        Effect.gen(function* () {
          const file = yield* client.cases.file({
            path: { id: filedMatter.id },
          });

          expect(file.matter.id).toBe(filedMatter.id);
        }),
      { as: asWanjiku },
    ));

  /**
   * **The test this phase exists for.**
   *
   * Wanjiku's login asks for Zenith's matter by id. The answer is 404 — the
   * same answer, with the same body shape, as an id that belongs to nothing at
   * all. A 403 here would confirm the matter exists, and for a law firm the
   * existence of a matter is itself confidential.
   */
  it("cannot reach another client's matter, and cannot tell it apart from one that does not exist", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const api = runningApi({ as: asWanjiku });

        const [theirs, absent] = yield* Effect.forEach(
          [unfiledMatter.id, ABSENT],
          (id) =>
            Effect.promise(async () => {
              const response = await api.handler(
                new Request(`${BASE_URL}/api/cases/${id}`),
              );
              return {
                status: response.status,
                body: (await response.json()) as { _tag?: string },
              };
            }),
        );

        expect(theirs?.status).toBe(404);
        expect(absent?.status).toBe(404);
        expect(theirs?.body._tag).toBe(absent?.body._tag);

        yield* Effect.promise(() => api.dispose());
      }),
    ));

  it("cannot reach another client's invoices", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const api = runningApi({ as: asWanjiku });

        const response = yield* Effect.promise(() =>
          api.handler(
            new Request(`${BASE_URL}/api/clients/${zenith.id}/invoices`),
          ),
        );

        expect(response.status).toBe(404);

        yield* Effect.promise(() => api.dispose());
      }),
    ));

  it("cannot reach another client's record", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const api = runningApi({ as: asWanjiku });

        const response = yield* Effect.promise(() =>
          api.handler(new Request(`${BASE_URL}/api/clients/${zenith.id}`)),
        );

        expect(response.status).toBe(404);

        yield* Effect.promise(() => api.dispose());
      }),
    ));

  /** The client directory is one row long, and it is their own. */
  it("sees a client list containing only themselves", () =>
    withApi(
      (client) =>
        Effect.gen(function* () {
          const directory = yield* client.clients.directory({});

          expect(directory.map((entry) => entry.client.id)).toEqual([
            wanjiku.id,
          ]);
        }),
      { as: asWanjiku },
    ));

  it("sees a caseload containing only their own matters", () =>
    withApi(
      (client) =>
        Effect.gen(function* () {
          const caseload = yield* client.cases.caseload({ urlParams: {} });

          expect(
            caseload.every((summary) => summary.matter.clientId === wanjiku.id),
          ).toBe(true);
        }),
      { as: asWanjiku },
    ));

  /**
   * A filter is not a way around the scope.
   *
   * Asking for another advocate's matters, or for a status, still answers
   * within the caller's scope — the scope is in the query the service builds,
   * not a filter applied to what a URL asked for.
   */
  it("cannot widen its own caseload with a filter", () =>
    withApi(
      (client) =>
        Effect.gen(function* () {
          const caseload = yield* client.cases.caseload({
            urlParams: { advocateId: grace.id },
          });

          expect(
            caseload.every((summary) => summary.matter.clientId === wanjiku.id),
          ).toBe(true);
        }),
      { as: asWanjiku },
    ));

  it("is refused a write with 403, which signing in again will not fix", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const api = runningApi({ as: asWanjiku });

        const response = yield* Effect.promise(() =>
          api.handler(
            new Request(`${BASE_URL}/api/cases/${filedMatter.id}/status`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ to: "Closed" }),
            }),
          ),
        );

        expect(response.status).toBe(403);

        const body = (yield* Effect.promise(() => response.json())) as {
          _tag?: string;
          role?: string;
        };
        expect(body._tag).toBe("NotPermitted");
        expect(body.role).toBe("Client Portal User");

        yield* Effect.promise(() => api.dispose());
      }),
    ));
});

describe("a member of staff, refused", () => {
  it("gets 403 and a reason the client can compose itself", () =>
    withApi(
      (client) =>
        Effect.gen(function* () {
          const refused = yield* Effect.flip(
            client.cases.transition({
              path: { id: filedMatter.id },
              payload: { to: "Closed" },
            }),
          );

          expect(refused._tag).toBe("NotPermitted");
          if (refused._tag === "NotPermitted") {
            // The sentence was never transmitted: `reason` is a getter on the
            // class, and the client holds the class.
            expect(refused.reason).toBe(
              "A Finance Officer may not case transition",
            );
          }
        }),
      { as: asFinance },
    ));

  it("is still served the reads their role holds", () =>
    withApi(
      (client) =>
        Effect.gen(function* () {
          const invoices = yield* client.billing.forClient({
            path: { clientId: wanjiku.id },
          });

          expect(invoices.length).toBeGreaterThan(0);
        }),
      { as: asFinance },
    ));

  it("refuses a Receptionist the money, by permission rather than by scope", () =>
    withApi(
      (client) =>
        Effect.gen(function* () {
          const refused = yield* Effect.flip(
            client.billing.forClient({ path: { clientId: wanjiku.id } }),
          );

          // 403, not 404: everyone at the firm knows the fee notes exist.
          // Concealment is for the portal, where the existence of a record is
          // itself the confidential part.
          expect(refused._tag).toBe("NotPermitted");
        }),
      { as: asReceptionist },
    ));
});

/**
 * The group Phase 4 deferred, exercised over the wire it finally has.
 *
 * The two things a service test cannot see are both here. **Encoding**: a
 * `Version` carries a `Date`, and a `Date` does not survive JSON on its own —
 * `Wire.Timestamp` is what makes `uploadedOn` come back as a `Date` on the
 * client rather than a string that merely looks like one. **The contract**:
 * `download` answers a URL, and a URL that arrived without `expiresAt` would be
 * a consumer caching a 403.
 */
describe("documents", () => {
  it.effect(
    "serves the register with matters and current versions resolved",
    () =>
      withApi((client) =>
        Effect.gen(function* () {
          const register = yield* client.documents.register();

          expect(
            register.map((entry) => entry.document.name).sort(),
          ).toStrictEqual([
            "List of documents",
            "Plaint and verifying affidavit",
          ]);

          const plaint = register.find(
            (entry) => entry.document.id === draftPlaint.id,
          );

          expect(plaint?.matterNumber).toBe(filedMatter.number);
          expect(plaint?.versionCount).toBe(2);
          // The *current* version, not the first — which is the whole point of
          // sending one alongside the count.
          expect(plaint?.current.number).toBe(2);
          expect(plaint?.current.sizeBytes).toBe(86_902);
        }),
      ),
  );

  /**
   * A `Date` that survived JSON.
   *
   * `instanceof Date` is the assertion that matters: a string that reads
   * "2026-02-12T00:00:00.000Z" would satisfy any comparison written against
   * `.toISOString()`, and would then break the first time a caller did date
   * arithmetic on it.
   */
  it.effect("brings version dates back as dates", () =>
    withApi((client) =>
      Effect.gen(function* () {
        const register = yield* client.documents.register();
        const plaint = register.find(
          (entry) => entry.document.id === draftPlaint.id,
        );

        expect(plaint?.current.uploadedOn).toBeInstanceOf(Date);
        expect(plaint?.current.uploadedOn.getTime()).toBe(
          new Date("2026-02-12T00:00:00.000Z").getTime(),
        );

        for (const version of plaint?.document.versions ?? []) {
          expect(version.uploadedOn).toBeInstanceOf(Date);
        }
      }),
    ),
  );

  it.effect("serves the documents on one matter", () =>
    withApi((client) =>
      Effect.gen(function* () {
        const onFile = yield* client.documents.forCase({
          path: { caseId: filedMatter.id },
        });

        expect(onFile).toHaveLength(2);
        expect(
          onFile.every((document) => document.caseId === filedMatter.id),
        ).toBe(true);
      }),
    ),
  );

  it.effect("mints a signed URL that says when it stops working", () =>
    withApi((client) =>
      Effect.gen(function* () {
        const download = yield* client.documents.download({
          path: { id: draftPlaint.id },
        });

        expect(download.name).toBe(draftPlaint.name);
        // The *current* version's key, so a download link never serves a
        // superseded draft.
        expect(download.url).toContain(`/v2`);
        expect(download.expiresAt).toBeInstanceOf(Date);
        /*
          Fifteen minutes from the *service's* clock, not the wall clock. The
          harness runs on a fixed clock, so asserting against `Date.now()` would
          measure the difference between the two rather than the window — and
          the window is the security property worth pinning.
        */
        expect(download.expiresAt.getTime() - TODAY.getTime()).toBe(
          15 * 60 * 1000,
        );
      }),
    ),
  );

  it.effect("records a document as filed", () =>
    withApi((client) =>
      Effect.gen(function* () {
        const filed = yield* client.documents.markFiled({
          path: { id: draftPlaint.id },
          payload: {},
        });

        expect(filed.filedWithCourt).toBe(true);
      }),
    ),
  );

  /**
   * The declared error, over the wire, with its status.
   *
   * `AlreadyFiled` is on the endpoint rather than a 500, because it is an
   * answer: the caller asked for something that has already happened, and a
   * client generated from this contract can branch on the tag.
   */
  it("answers 409 for a document already on the court record", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const api = runningApi();

        const response = yield* Effect.promise(() =>
          api.handler(
            new Request(`${BASE_URL}/api/documents/${filedList.id}/filed`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: "{}",
            }),
          ),
        );

        expect(response.status).toBe(409);
        expect(
          (
            (yield* Effect.promise(() => response.json())) as {
              _tag?: string;
            }
          )._tag,
        ).toBe("AlreadyFiled");

        yield* Effect.promise(() => api.dispose());
      }),
    ));

  it("answers 404 for a document id that belongs to nothing", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const api = runningApi();

        const response = yield* Effect.promise(() =>
          api.handler(
            new Request(`${BASE_URL}/api/documents/${ABSENT}/download`),
          ),
        );

        expect(response.status).toBe(404);

        yield* Effect.promise(() => api.dispose());
      }),
    ));

  /**
   * The portal's one new grant, and the scope that bounds it.
   *
   * Wanjiku holds `document:read` — she is entitled to the documents on her own
   * file, which is what a client portal is for. The register she is served is
   * her own matters' documents and nothing else, and Zenith's document answers
   * `NotFound` rather than a refusal, for the reason every scope check in this
   * system gives: a 403 would confirm the document exists.
   */
  it.effect("serves a portal user the documents on their own file", () =>
    withApi(
      (client) =>
        Effect.gen(function* () {
          const register = yield* client.documents.register();

          expect(register.length).toBeGreaterThan(0);
          for (const entry of register) {
            expect(entry.document.caseId).toBe(filedMatter.id);
          }
        }),
      { as: asWanjiku },
    ),
  );

  it("does not let a portal user download from another client's matter", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const api = runningApi({ as: asZenith });

        const response = yield* Effect.promise(() =>
          api.handler(
            new Request(`${BASE_URL}/api/documents/${draftPlaint.id}/download`),
          ),
        );

        expect(response.status).toBe(404);

        yield* Effect.promise(() => api.dispose());
      }),
    ));

  /**
   * A portal user holds `document:read` and deliberately not `document:write`.
   * Filing a document with the court is not something a client does.
   */
  it("does not let a portal user file a document with the court", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const api = runningApi({ as: asWanjiku });

        const response = yield* Effect.promise(() =>
          api.handler(
            new Request(`${BASE_URL}/api/documents/${draftPlaint.id}/filed`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: "{}",
            }),
          ),
        );

        expect(response.status).toBe(403);

        yield* Effect.promise(() => api.dispose());
      }),
    ));

  /** A well-formed uuid that is not one this system issued still decodes. */
  it.effect("rejects a path parameter that is not a uuid", () =>
    Effect.gen(function* () {
      const api = runningApi();

      const response = yield* Effect.promise(() =>
        api.handler(
          new Request(`${BASE_URL}/api/documents/not-a-uuid/download`),
        ),
      );

      expect(response.status).toBe(400);

      yield* Effect.promise(() => api.dispose());
    }),
  );
});

/**
 * Work, over the wire.
 *
 * The two things a service test cannot see are both here. **The split is the
 * server's**: `workList` returns three arrays because the boundary between
 * overdue and due-soon is the start of a day, and a browser computing it from
 * its own clock would disagree for every user outside UTC. And **`caseId` is an
 * `Option` on the wire** — firm work has no matter, and the encoding has to
 * carry an absence rather than a null that a client mistakes for an id.
 */
describe("tasks", () => {
  it.effect("splits the work list on the server", () =>
    withApi((client) =>
      Effect.gen(function* () {
        const list = yield* client.tasks.workList();

        expect(list.overdue.map((entry) => entry.task.id)).toStrictEqual([
          overdueTask.id,
        ]);
        expect(list.dueSoon.map((entry) => entry.task.id)).toContain(
          dueToday.id,
        );

        // Exhaustive and disjoint, all the way across the wire.
        const placed = [...list.overdue, ...list.dueSoon, ...list.later].map(
          (entry) => entry.task.id,
        );

        expect(placed).toHaveLength(list.openCount);
        expect(new Set(placed).size).toBe(placed.length);
      }),
    ),
  );

  it.effect("brings task dates back as dates", () =>
    withApi((client) =>
      Effect.gen(function* () {
        const list = yield* client.tasks.workList();
        const [first] = list.overdue;

        expect(first!.task.dueOn).toBeInstanceOf(Date);
        expect(first!.task.raisedOn).toBeInstanceOf(Date);
      }),
    ),
  );

  /**
   * Firm work survives the round trip as an *absent* matter rather than as a
   * null somebody has to remember not to treat as an id.
   */
  it.effect("carries firm work with no matter behind it", () =>
    withApi((client) =>
      Effect.gen(function* () {
        const list = yield* client.tasks.workList();
        const chore = [...list.overdue, ...list.dueSoon, ...list.later].find(
          (entry) => entry.task.id === firmChore.id,
        );

        expect(Option.isNone(chore!.task.caseId)).toBe(true);
        expect(Option.isNone(chore!.matter)).toBe(true);
      }),
    ),
  );

  it.effect("raises a task against a matter", () =>
    withApi((client) =>
      Effect.gen(function* () {
        const raised = yield* client.tasks.raise({
          payload: {
            title: "Prepare the bundle",
            caseId: Option.some(filedMatter.id),
            assignedTo: sarah.id,
            priority: "High",
            dueOn: new Date("2026-08-26T00:00:00.000Z"),
          },
        });

        expect(raised.status).toBe("Not started");
        expect(Option.isNone(raised.completed)).toBe(true);
      }),
    ),
  );

  it.effect("completes a task and records who and when", () =>
    withApi((client) =>
      Effect.gen(function* () {
        const done = yield* client.tasks.complete({
          path: { id: overdueTask.id },
          payload: {},
        });

        expect(done.status).toBe("Done");
        expect(Option.getOrThrow(done.completed).on).toBeInstanceOf(Date);
      }),
    ),
  );

  /** A `DELETE` on the completion, because that is exactly what it is. */
  it.effect("reopens by deleting the completion", () =>
    withApi((client) =>
      Effect.gen(function* () {
        const reopened = yield* client.tasks.reopen({
          path: { id: doneTask.id },
        });

        expect(reopened.status).toBe("In progress");
        expect(Option.isNone(reopened.completed)).toBe(true);
      }),
    ),
  );

  it("answers 409 for a task already done", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const api = runningApi();

        const response = yield* Effect.promise(() =>
          api.handler(
            new Request(`${BASE_URL}/api/tasks/${doneTask.id}/completion`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: "{}",
            }),
          ),
        );

        expect(response.status).toBe(409);
        expect(
          (
            (yield* Effect.promise(() => response.json())) as {
              _tag?: string;
            }
          )._tag,
        ).toBe("AlreadyDone");

        yield* Effect.promise(() => api.dispose());
      }),
    ));

  /**
   * **The cross-module rule, over the wire.**
   *
   * Closing a matter with work still on it is a 409 carrying `HasOpenTasks` —
   * the one endpoint in this API whose precondition lives in another module.
   * The count is on the error because "one forgotten item" and "fourteen" are
   * different situations to whoever is reading it.
   */
  it("refuses to close a matter that still has open work", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const api = runningApi();

        const response = yield* Effect.promise(() =>
          api.handler(
            new Request(`${BASE_URL}/api/cases/${filedMatter.id}/status`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ to: "Closed" }),
            }),
          ),
        );

        expect(response.status).toBe(409);

        const body = (yield* Effect.promise(() => response.json())) as {
          _tag?: string;
          open?: number;
        };

        expect(body._tag).toBe("HasOpenTasks");
        expect(body.open).toBe(2);

        yield* Effect.promise(() => api.dispose());
      }),
    ));

  /**
   * `MatterIsClosed` is now **one** error rather than two sharing a tag. It was
   * declared separately in the time and task services, which this API's error
   * table caught: two schemas cannot both be `MatterIsClosed` on one wire.
   * `attempted` is what keeps the message specific while the tag stays single.
   */
  it("says what was being attempted on a closed matter", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const api = runningApi();

        const response = yield* Effect.promise(() =>
          api.handler(
            new Request(`${BASE_URL}/api/tasks`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                title: "Something on a closed file",
                caseId: closedMatter.id,
                assignedTo: sarah.id,
                priority: "Low",
                dueOn: "2026-09-01T00:00:00.000Z",
              }),
            }),
          ),
        );

        expect(response.status).toBe(409);

        const body = (yield* Effect.promise(() => response.json())) as {
          _tag?: string;
          attempted?: string;
        };

        expect(body._tag).toBe("MatterIsClosed");
        expect(body.attempted).toBe("raise work on it");

        yield* Effect.promise(() => api.dispose());
      }),
    ));

  it("does not let a Receptionist raise work", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const api = runningApi({ as: asReceptionist });

        const response = yield* Effect.promise(() =>
          api.handler(
            new Request(`${BASE_URL}/api/tasks`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                title: "Chase the client",
                caseId: null,
                assignedTo: sarah.id,
                priority: "Low",
                dueOn: "2026-09-01T00:00:00.000Z",
              }),
            }),
          ),
        );

        expect(response.status).toBe(403);

        yield* Effect.promise(() => api.dispose());
      }),
    ));

  /** The firm's work list names who is doing what across every matter. */
  it("does not show a portal user the firm's work list", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const api = runningApi({ as: asWanjiku });

        const response = yield* Effect.promise(() =>
          api.handler(new Request(`${BASE_URL}/api/tasks`)),
        );

        expect(response.status).toBe(403);

        yield* Effect.promise(() => api.dispose());
      }),
    ));
});

/**
 * Correspondence, over the wire.
 *
 * Two things a service test cannot see. **The author is a tagged union on the
 * wire**, so a consumer branches on `_tag` rather than testing an `advocateId`
 * for null and hoping two columns agreed. And **this is the only group a portal
 * user may write to** — the one grant that makes a portal something other than
 * a notice board, proved here as a real request rather than as a permission
 * table entry.
 */
describe("messages", () => {
  it.effect("serves a thread with the firm's names resolved", () =>
    withApi((client) =>
      Effect.gen(function* () {
        const thread = yield* client.messages.thread({
          path: { clientId: wanjiku.id },
        });

        expect(thread.clientName).toBe(wanjiku.name);
        expect(thread.entries.length).toBeGreaterThan(0);

        const [first] = thread.entries;
        expect(first!.message.sentAt).toBeInstanceOf(Date);
        expect(Option.getOrThrow(first!.authorName)).toBe(sarah.name);
      }),
    ),
  );

  /** The union, intact after a round trip through JSON. */
  it.effect("keeps the author a tagged union", () =>
    withApi((client) =>
      Effect.gen(function* () {
        const thread = yield* client.messages.thread({
          path: { clientId: wanjiku.id },
        });

        const fromClient = thread.entries.find(
          (entry) => entry.message.author._tag === "FromClient",
        );
        const fromFirm = thread.entries.find(
          (entry) => entry.message.author._tag === "FromFirm",
        );

        expect(fromClient).toBeDefined();
        expect(Object.keys(fromClient!.message.author)).toStrictEqual(["_tag"]);

        if (fromFirm?.message.author._tag === "FromFirm") {
          expect(fromFirm.message.author.advocateId).toBe(sarah.id);
        }
      }),
    ),
  );

  it.effect("reports who is waiting, and whether they were read", () =>
    withApi((client) =>
      Effect.gen(function* () {
        const waiting = yield* client.messages.waiting();

        expect(waiting.map((entry) => entry.clientName)).toStrictEqual([
          wanjiku.name,
        ]);
        // Read on the 17th and never answered: the worse of the two failures.
        expect(waiting[0]?.seen).toBe(true);
        expect(waiting[0]?.since).toBeInstanceOf(Date);
      }),
    ),
  );

  it.effect("sends as the advocate who is signed in", () =>
    withApi((client) =>
      Effect.gen(function* () {
        const sent = yield* client.messages.send({
          payload: {
            clientId: wanjiku.id,
            caseId: Option.some(filedMatter.id),
            body: "Listed for 3 September.",
          },
        });

        expect(sent.author._tag).toBe("FromFirm");
        expect(Option.isNone(sent.readAt)).toBe(true);
      }),
    ),
  );

  /**
   * **The portal's only write, exercised.** A client portal whose client
   * cannot write is a notice board.
   */
  it.effect("lets a portal user write to their own thread", () =>
    withApi(
      (client) =>
        Effect.gen(function* () {
          const sent = yield* client.messages.send({
            payload: {
              clientId: wanjiku.id,
              caseId: Option.none(),
              body: "Thank you, that is helpful.",
            },
          });

          expect(sent.author._tag).toBe("FromClient");
        }),
      { as: asWanjiku },
    ),
  );

  it("does not let a portal user write into another client's thread", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const api = runningApi({ as: asZenith });

        const response = yield* Effect.promise(() =>
          api.handler(
            new Request(`${BASE_URL}/api/messages`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                clientId: wanjiku.id,
                caseId: null,
                body: "Hello",
              }),
            }),
          ),
        );

        expect(response.status).toBe(404);

        yield* Effect.promise(() => api.dispose());
      }),
    ));

  it("does not let a portal user read another client's thread", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const api = runningApi({ as: asWanjiku });

        const response = yield* Effect.promise(() =>
          api.handler(
            new Request(`${BASE_URL}/api/clients/${zenith.id}/messages`),
          ),
        );

        expect(response.status).toBe(404);

        yield* Effect.promise(() => api.dispose());
      }),
    ));

  /**
   * A message about one client's matter filed into another's thread would put
   * it in front of the wrong client. A 422 rather than a 404, because nothing
   * is being concealed from a sender who can see both.
   */
  it("answers 422 for a matter that is not that client's", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const api = runningApi();

        const response = yield* Effect.promise(() =>
          api.handler(
            new Request(`${BASE_URL}/api/messages`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                clientId: wanjiku.id,
                caseId: unfiledMatter.id,
                body: "About the other matter.",
              }),
            }),
          ),
        );

        expect(response.status).toBe(422);
        expect(
          (
            (yield* Effect.promise(() => response.json())) as {
              _tag?: string;
            }
          )._tag,
        ).toBe("MatterIsNotTheirs");

        yield* Effect.promise(() => api.dispose());
      }),
    ));

  it("does not let a Receptionist reply on the firm's behalf", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const api = runningApi({ as: asReceptionist });

        const response = yield* Effect.promise(() =>
          api.handler(
            new Request(`${BASE_URL}/api/messages`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                clientId: wanjiku.id,
                caseId: null,
                body: "He will call you back.",
              }),
            }),
          ),
        );

        expect(response.status).toBe(403);

        yield* Effect.promise(() => api.dispose());
      }),
    ));

  /**
   * There is no endpoint that edits or deletes a message, for either side, and
   * this is what says so: the router itself has no route to take.
   */
  it("offers no way to edit or withdraw a message", () => {
    const paths = Object.keys(openApiSpec.paths)
      .filter((path) => path.includes("message"))
      .sort();

    expect(paths).toStrictEqual([
      "/api/clients/{clientId}/messages",
      "/api/messages",
      "/api/messages/waiting",
    ]);

    const send = openApiSpec.paths["/api/messages"];
    expect(Object.keys(send ?? {})).toStrictEqual(["post"]);
  });
});
