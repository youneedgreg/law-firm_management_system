import { describe, expect, it } from "@effect/vitest";
import { Effect, Either, Schema } from "effect";
import { BASE_URL, runningApi, withApi } from "../../test/api-harness";
import {
  closedMatter,
  daniel,
  filedMatter,
  grace,
  lapsed,
  overdueInvoice,
  partPaidInvoice,
  sarah,
  settledInvoice,
  unfiledMatter,
  wanjiku,
  zenith,
} from "../../test/fixtures";
import { CaseId, ClientId, InvoiceId } from "../domain/shared/ids";
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
describe("the OpenAPI document", () => {
  it("describes every path the contract declares", () => {
    expect(Object.keys(openApiSpec.paths).sort()).toEqual([
      "/api/cases",
      "/api/cases/intake-choices",
      "/api/cases/{id}",
      "/api/cases/{id}/status",
      "/api/clients",
      "/api/clients/{clientId}/invoices",
      "/api/clients/{id}",
      "/api/invoices/{id}",
    ]);
  });

  /**
   * The status codes live on the error schemas in `failures.ts`, stated once
   * and picked up by every endpoint that can fail that way. This is what proves
   * they reached the document rather than only the router.
   */
  it("carries the status code each refusal was annotated with", () => {
    const open = openApiSpec.paths["/api/cases"]?.post;
    expect(Object.keys(open?.responses ?? {}).sort()).toEqual([
      "201",
      "400",
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
