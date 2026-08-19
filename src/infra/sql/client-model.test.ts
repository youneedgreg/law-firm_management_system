import { Either, Schema } from "effect";
import { describe, expect, it } from "vitest";
import * as Client from "../../domain/client/client";
import { ClientId, KenyanPhone, KraPin } from "../../domain/shared/ids";
import { ClientFromRow } from "./client-model";

/**
 * The rows ↔ `Client` bridge.
 *
 * The mapping in the other direction is trivial; this file is about the way
 * back, where a flat row plus a list has to become a union whose two arms are
 * not interchangeable. Two of the tests below are the ones that earn the
 * `transformOrFail`: rows that Postgres will happily store and the domain
 * cannot represent.
 */

const id = Schema.decodeSync(ClientId)("44444444-4444-4444-8444-444444444444");
const phone = Schema.decodeSync(KenyanPhone)("+254722445109");

const individual = Client.Individual.make({
  id,
  number: "CLT-1001",
  name: "Wanjiku Mwangi",
  email: "wanjiku@example.co.ke",
  phone,
  onboardedOn: new Date("2026-01-10T00:00:00.000Z"),
});

const corporate = Client.Corporate.make({
  id,
  number: "CLT-1002",
  name: "Zenith Distributors Ltd",
  email: "legal@zenith.co.ke",
  phone,
  onboardedOn: new Date("2026-01-10T00:00:00.000Z"),
  contacts: [
    { name: "Grace Otieno", role: "Company Secretary", phone },
    {
      name: "Peter Kimani",
      role: "Finance Director",
      email: "pk@zenith.co.ke",
    },
  ],
  registrationNumber: "PVT-9XYZ123",
});

const encode = Schema.encodeSync(ClientFromRow);
const decode = Schema.decodeUnknownSync(ClientFromRow);
const decodeEither = Schema.decodeUnknownEither(ClientFromRow);

describe("a client survives the round trip", () => {
  it("as an individual", () => {
    expect(decode(encode(individual))).toStrictEqual(individual);
  });

  it("as a company, with its contacts in the order they were given", () => {
    const result = decode(encode(corporate));

    expect(result).toStrictEqual(corporate);
    expect(Client.primaryContact(result)).toBe("Grace Otieno");
  });

  it("carrying a KRA PIN", () => {
    const withPin = Client.Individual.make({
      ...individual,
      kraPin: Schema.decodeSync(KraPin)("A123456789Z"),
    });

    expect(decode(encode(withPin))).toStrictEqual(withPin);
  });

  it("writes an individual's corporate-only columns as null", () => {
    const { client, contacts } = encode(individual);

    expect(client.registrationNumber).toBeNull();
    expect(client.kraPin).toBeNull();
    expect(contacts).toStrictEqual([]);
  });

  it("records the discriminator in the kind column", () => {
    expect(encode(individual).client.kind).toBe("Individual");
    expect(encode(corporate).client.kind).toBe("Corporate");
  });
});

describe("rows the database allows and the domain does not", () => {
  /**
   * No `NOT NULL` can say "at least one row in another table", so this is the
   * integrity check the schema cannot make. A company with nobody recorded as
   * able to instruct is not a company with an empty contact list — it is a
   * matter that cannot proceed.
   */
  it("refuses a corporate client with no contacts", () => {
    const result = decodeEither({ ...encode(corporate), contacts: [] });

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.message).toContain("no contacts");
    }
  });

  /**
   * The domain has nowhere to put these, so decoding would silently discard
   * stored data. A refusal gets noticed; a silent drop gets discovered when
   * someone asks why a contact vanished.
   */
  it("refuses an individual carrying contacts", () => {
    const result = decodeEither({
      ...encode(individual),
      contacts: encode(corporate).contacts,
    });

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.message).toContain("only corporate clients");
    }
  });

  it("refuses an individual with a registration number", () => {
    const { client, contacts } = encode(individual);
    const result = decodeEither({
      client: { ...client, registrationNumber: "PVT-9XYZ123" },
      contacts,
    });

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.message).toContain("registration number");
    }
  });

  it("refuses a client number in the wrong format", () => {
    const { client, contacts } = encode(individual);

    expect(
      Either.isLeft(
        decodeEither({ client: { ...client, number: "1001" }, contacts }),
      ),
    ).toBe(true);
  });

  it("refuses a phone number that is not Kenyan", () => {
    const { client, contacts } = encode(individual);

    expect(
      Either.isLeft(
        decodeEither({
          client: { ...client, phone: "+447700900123" },
          contacts,
        }),
      ),
    ).toBe(true);
  });
});
