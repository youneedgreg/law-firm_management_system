import { Either, Schema } from "effect";
import { ClientId, KenyanPhone, KraPin, kraPinHolder } from "../shared/ids";

/**
 * Clients of the firm — individuals and corporate entities.
 *
 * Modelled as a discriminated union rather than one struct with a `type` field
 * and a pile of optionals. A company has no date of birth and an individual has
 * no registered office, and a shape that admits both leaves every consumer
 * checking which fields are meaningful.
 */

export const ClientContact = Schema.Struct({
  name: Schema.NonEmptyTrimmedString,
  role: Schema.NonEmptyTrimmedString,
  email: Schema.optional(
    Schema.String.pipe(Schema.pattern(/^[^@\s]+@[^@\s]+$/)),
  ),
  phone: Schema.optional(KenyanPhone),
});

export type ClientContact = typeof ClientContact.Type;

export const Individual = Schema.TaggedStruct("Individual", {
  id: ClientId,
  number: Schema.String.pipe(Schema.pattern(/^CLT-\d{4}$/)),
  name: Schema.NonEmptyTrimmedString,
  email: Schema.String.pipe(Schema.pattern(/^[^@\s]+@[^@\s]+$/)),
  phone: KenyanPhone,
  kraPin: Schema.optional(KraPin),
  onboardedOn: Schema.DateFromSelf,
});

export const Corporate = Schema.TaggedStruct("Corporate", {
  id: ClientId,
  number: Schema.String.pipe(Schema.pattern(/^CLT-\d{4}$/)),
  name: Schema.NonEmptyTrimmedString,
  email: Schema.String.pipe(Schema.pattern(/^[^@\s]+@[^@\s]+$/)),
  phone: KenyanPhone,
  kraPin: Schema.optional(KraPin),
  onboardedOn: Schema.DateFromSelf,
  /**
   * At least one. A company cannot give instructions; a person does, and a
   * matter with no one authorised to instruct is a matter that cannot proceed.
   */
  contacts: Schema.NonEmptyArray(ClientContact),
  registrationNumber: Schema.optional(Schema.NonEmptyTrimmedString),
});

export const Client = Schema.Union(Individual, Corporate);
export type Client = typeof Client.Type;

export class PinDoesNotMatchClientType extends Schema.TaggedError<PinDoesNotMatchClientType>()(
  "PinDoesNotMatchClientType",
  { clientType: Schema.String, pin: Schema.String },
) {
  get reason(): string {
    const expected = this.clientType === "Individual" ? "A" : "P";
    return (
      `A ${this.clientType.toLowerCase()} client's KRA PIN should begin with ` +
      `${expected}; ${this.pin} does not. Check whether the PIN or the client ` +
      `type is wrong`
    );
  }
}

/**
 * Checks the PIN prefix against the kind of client.
 *
 * KRA issues `A` PINs to individuals and `P` PINs to entities, so a corporate
 * client holding an `A` PIN means one of the two records is wrong — usually a
 * sole trader entered as a company, or a director's own PIN captured instead of
 * the company's. Worth catching at intake, because it propagates onto every
 * invoice afterwards.
 *
 * Kept out of the schema on purpose: a schema refusal would make the client
 * unsavable, and the right response here is to query it with whoever did the
 * intake, not to block the file from being opened.
 */
export const checkPin = (
  client: Client,
): Either.Either<Client, PinDoesNotMatchClientType> => {
  if (client.kraPin === undefined) return Either.right(client);

  const holder = kraPinHolder(client.kraPin);
  const matches =
    client._tag === "Individual"
      ? holder === "individual"
      : holder === "entity";

  return matches
    ? Either.right(client)
    : Either.left(
        new PinDoesNotMatchClientType({
          clientType: client._tag,
          pin: client.kraPin,
        }),
      );
};

/** Who to contact — the client themselves, or the corporate contact. */
export const primaryContact = (client: Client): string =>
  client._tag === "Individual" ? client.name : client.contacts[0].name;
