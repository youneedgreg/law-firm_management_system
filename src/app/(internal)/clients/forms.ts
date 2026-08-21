import { Schema } from "effect";
import * as ClientDomain from "@/domain/client/client";
import { KenyanPhone, KraPin, normalisePhone } from "@/domain/shared/ids";
import type { AmendClient, TakeOnClient } from "@/services/client-service";

/**
 * The boundary between the intake form and the domain.
 *
 * The one interesting decision is the phone number. `KenyanPhone` is E.164 —
 * `+254722445109` — and nobody types that; a Kenyan writes `0722 445 109`. A
 * form that demanded E.164 would be a form people work around, so
 * `normalisePhone` (the domain's own, already used by the seed) runs here and
 * the schema refuses what it cannot normalise. The conversion happens once, at
 * a boundary, which is the same rule the money forms follow.
 */

export const submitted = (form: FormData): Record<string, string> => {
  const fields: Record<string, string> = {};
  for (const [name, value] of form.entries()) {
    if (typeof value === "string" && value.trim() !== "") {
      fields[name] = value;
    }
  }
  return fields;
};

/** `0722 445 109` → `+254722445109`, refusing anything that is not a number. */
const PhoneInput = Schema.transform(Schema.String, Schema.String, {
  strict: true,
  decode: (typed) => normalisePhone(typed),
  encode: (e164) => e164,
}).pipe(Schema.compose(KenyanPhone));

const DayInput = Schema.transform(
  Schema.String.pipe(Schema.pattern(/^\d{4}-\d{2}-\d{2}$/)),
  Schema.DateFromSelf,
  {
    strict: true,
    decode: (day) => new Date(`${day}T00:00:00.000Z`),
    encode: (date) => date.toISOString().slice(0, 10),
  },
).annotations({ identifier: "DayInput" });

/**
 * A corporate contact, from three flat inputs.
 *
 * One contact on the form, and `Corporate.contacts` is a `NonEmptyArray` — so
 * the form collects the person who can instruct, which is the one the domain
 * insists on, and further contacts are an amendment. A repeating fieldset at
 * intake would be machinery for a case that is rare at the moment a file is
 * opened.
 */
const Contact = Schema.Struct({
  contactName: Schema.NonEmptyTrimmedString,
  contactRole: Schema.NonEmptyTrimmedString,
  contactEmail: Schema.optional(
    Schema.String.pipe(Schema.pattern(/^[^@\s]+@[^@\s]+$/)),
  ),
  contactPhone: Schema.optional(PhoneInput),
});

const Shared = {
  name: Schema.NonEmptyTrimmedString,
  email: Schema.String.pipe(Schema.pattern(/^[^@\s]+@[^@\s]+$/)),
  phone: PhoneInput,
  kraPin: Schema.optional(KraPin),
  onboardedOn: DayInput,
};

export const TakeOnIndividualForm = Schema.Struct({
  _tag: Schema.Literal("Individual"),
  ...Shared,
});

export const TakeOnCorporateForm = Schema.transform(
  Schema.Struct({
    _tag: Schema.Literal("Corporate"),
    ...Shared,
    ...Contact.fields,
    registrationNumber: Schema.optional(Schema.NonEmptyTrimmedString),
  }),
  Schema.typeSchema(
    Schema.Struct({
      _tag: Schema.Literal("Corporate"),
      name: Schema.NonEmptyTrimmedString,
      email: Schema.String,
      phone: KenyanPhone,
      kraPin: Schema.optional(KraPin),
      onboardedOn: Schema.DateFromSelf,
      contacts: Schema.NonEmptyArray(ClientDomain.ClientContact),
      registrationNumber: Schema.optional(Schema.NonEmptyTrimmedString),
    }),
  ),
  {
    strict: true,
    decode: (form) => ({
      _tag: "Corporate" as const,
      name: form.name,
      email: form.email,
      phone: form.phone,
      ...(form.kraPin === undefined ? {} : { kraPin: form.kraPin }),
      onboardedOn: form.onboardedOn,
      contacts: [
        {
          name: form.contactName,
          role: form.contactRole,
          ...(form.contactEmail === undefined
            ? {}
            : { email: form.contactEmail }),
          ...(form.contactPhone === undefined
            ? {}
            : { phone: form.contactPhone }),
        },
      ] as const,
      ...(form.registrationNumber === undefined
        ? {}
        : { registrationNumber: form.registrationNumber }),
    }),
    encode: () => {
      throw new Error("TakeOnCorporateForm is decode-only");
    },
  },
);

/**
 * The two halves, chosen by the `_tag` the form submits.
 *
 * A union rather than one struct with optional contact fields, because that is
 * what `Client` is — and flattening it here would mean the form could submit a
 * corporate client with no contact and only find out at the service.
 */
export const TakeOnClientForm = Schema.Union(
  TakeOnIndividualForm,
  TakeOnCorporateForm,
);

export const asTakeOn = (form: typeof TakeOnClientForm.Type): TakeOnClient =>
  form as TakeOnClient;

export const AmendClientForm = Schema.Struct({
  name: Schema.optional(Schema.NonEmptyTrimmedString),
  email: Schema.optional(
    Schema.String.pipe(Schema.pattern(/^[^@\s]+@[^@\s]+$/)),
  ),
  phone: Schema.optional(PhoneInput),
  kraPin: Schema.optional(KraPin),
  registrationNumber: Schema.optional(Schema.NonEmptyTrimmedString),
});

export const asAmend = (form: typeof AmendClientForm.Type): AmendClient => form;
