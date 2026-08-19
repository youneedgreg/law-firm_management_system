import { Model } from "@effect/sql";
import { Option, ParseResult, Schema } from "effect";
import * as Client from "../../domain/client/client";
import { ClientId, KenyanPhone, KraPin } from "../../domain/shared/ids";
import { CalendarDate } from "./columns";

/**
 * The `clients` and `client_contacts` tables, and the bridge to a `Client`.
 *
 * The interesting mismatch here is shape rather than type. The domain models a
 * client as `Individual | Corporate` — a union, because a company has contacts
 * who can instruct and a person does not. Postgres models it as one table with
 * a `kind` column and columns that only apply to one side, because that is what
 * relational storage offers.
 *
 * Collapsing a union into a flat row is the cheap direction. Reconstituting the
 * union is where the care goes: a corporate row with no contacts is not a
 * corporate client with an empty list, it is a row that cannot be turned into a
 * valid client, and this file says so rather than inventing one.
 */

/** Same shape the domain accepts; mirrored here so a bad row fails early. */
const EmailAddress = Schema.String.pipe(
  Schema.pattern(/^[^@\s]+@[^@\s]+$/),
  Schema.annotations({ identifier: "EmailAddress" }),
);

const ClientNumber = Schema.String.pipe(
  Schema.pattern(/^CLT-\d{4}$/),
  Schema.annotations({ identifier: "ClientNumber" }),
);

/**
 * The columns of a contact that carry meaning, without the storage bookkeeping.
 *
 * A contact has a primary key in Postgres and no identity in the domain: it is
 * a value owned by its client, not an entity anyone refers to. Keeping the id
 * out of this shape is what lets the bridge below stay a total, deterministic
 * mapping — an `encode` that had to mint a uuid would be neither.
 */
export class ContactBody extends Model.Class<ContactBody>("ContactBody")({
  name: Schema.NonEmptyTrimmedString,
  role: Schema.NonEmptyTrimmedString,
  email: Model.FieldOption(EmailAddress),
  phone: Model.FieldOption(KenyanPhone),
}) {}

/**
 * The `client_contacts` row: a contact, plus the bookkeeping Postgres needs.
 *
 * `ordinal` is the position in the client's list, and it exists because the
 * domain treats `contacts[0]` as the person the firm takes instructions from.
 * Storing a set and reading it back without an `ORDER BY` would let that be
 * whichever row Postgres returned first.
 */
export class ClientContactRow extends Model.Class<ClientContactRow>(
  "ClientContactRow",
)({
  id: Schema.UUID,
  clientId: ClientId,
  ordinal: Schema.Int.pipe(Schema.nonNegative()),
  ...Model.fields(ContactBody),
}) {}

/** The `clients` row. */
export class ClientRow extends Model.Class<ClientRow>("ClientRow")({
  id: ClientId,
  number: ClientNumber,
  kind: Schema.Literal("Individual", "Corporate"),
  name: Schema.NonEmptyTrimmedString,
  email: EmailAddress,
  phone: KenyanPhone,
  kraPin: Model.FieldOption(KraPin),
  registrationNumber: Model.FieldOption(Schema.NonEmptyTrimmedString),
  onboardedOn: CalendarDate,
  createdAt: Model.Generated(Schema.DateFromSelf),
}) {}

/**
 * A client, as it comes out of the two tables.
 *
 * Contacts arrive as a separate array rather than a join, so the client row is
 * not repeated once per contact and a client with no contacts is not confused
 * with a missing client.
 */
export const ClientRowWithContacts = Schema.Struct({
  client: ClientRow.insert,
  contacts: Schema.Array(ContactBody.insert),
});

// ── The bridge ────────────────────────────────────────────────────────────

const shared = (row: typeof ClientRow.insert.Type) => {
  const kraPin = Option.getOrUndefined(row.kraPin);
  return {
    id: row.id,
    number: row.number,
    name: row.name,
    email: row.email,
    phone: row.phone,
    onboardedOn: row.onboardedOn,
    ...(kraPin === undefined ? {} : { kraPin }),
  };
};

const toContact = (
  body: typeof ContactBody.insert.Type,
): Client.ClientContact => {
  const email = Option.getOrUndefined(body.email);
  const phone = Option.getOrUndefined(body.phone);
  return {
    name: body.name,
    role: body.role,
    ...(email === undefined ? {} : { email }),
    ...(phone === undefined ? {} : { phone }),
  };
};

const fromContact = (
  contact: Client.ClientContact,
): typeof ContactBody.insert.Type => ({
  name: contact.name,
  role: contact.role,
  email: Option.fromNullable(contact.email),
  phone: Option.fromNullable(contact.phone),
});

/**
 * Rows ↔ `Client`.
 *
 * Two failures are possible on the way in, and both are integrity problems the
 * schema cannot express:
 *
 * - a **corporate client with no contacts**, which the domain forbids because
 *   a company cannot give instructions and a matter with nobody authorised to
 *   instruct cannot proceed. A `NOT NULL` cannot say "at least one row in
 *   another table", so it is caught here.
 * - an **individual carrying contacts**, which would otherwise be dropped on
 *   the floor. Silently discarding stored data is worse than refusing to read
 *   it: the refusal gets fixed, the silent loss gets discovered much later.
 */
export const ClientFromRow = Schema.transformOrFail(
  ClientRowWithContacts,
  // As in `CaseFromRow`: the type side, so ids stay branded.
  Schema.typeSchema(Client.Client),
  {
    strict: true,

    decode: ({ client, contacts }, _options, ast) => {
      const fail = (message: string) =>
        ParseResult.fail(
          new ParseResult.Type(
            ast,
            { client, contacts },
            `client ${client.number}: ${message}`,
          ),
        );

      if (client.kind === "Individual") {
        if (contacts.length > 0) {
          return fail(
            `is an individual but has ${contacts.length} contact row(s); ` +
              `only corporate clients have contacts`,
          );
        }
        if (Option.isSome(client.registrationNumber)) {
          return fail("is an individual but has a registration number");
        }
        return ParseResult.succeed(Client.Individual.make(shared(client)));
      }

      const [first, ...rest] = contacts.map(toContact);
      if (first === undefined) {
        return fail(
          "is a corporate client with no contacts, so nobody is recorded as " +
            "able to instruct the firm",
        );
      }

      const registrationNumber = Option.getOrUndefined(
        client.registrationNumber,
      );

      return ParseResult.succeed(
        Client.Corporate.make({
          ...shared(client),
          contacts: [first, ...rest],
          ...(registrationNumber === undefined ? {} : { registrationNumber }),
        }),
      );
    },

    encode: (client) =>
      ParseResult.succeed({
        client: {
          id: client.id,
          number: client.number,
          kind: client._tag,
          name: client.name,
          email: client.email,
          phone: client.phone,
          kraPin: Option.fromNullable(client.kraPin),
          registrationNumber: Option.fromNullable(
            client._tag === "Corporate" ? client.registrationNumber : undefined,
          ),
          onboardedOn: client.onboardedOn,
        },
        contacts:
          client._tag === "Corporate" ? client.contacts.map(fromContact) : [],
      }),
  },
).annotations({ identifier: "ClientFromRow" });
