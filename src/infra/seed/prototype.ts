import { Either, Schema } from "effect";
import * as Billing from "../../domain/billing/invoice";
import * as Matter from "../../domain/case/case";
import * as ClientDomain from "../../domain/client/client";
import * as Advocate from "../../domain/firm/advocate";
import { normalisePhone } from "../../domain/shared/ids";
import * as Money from "../../domain/shared/money";
import * as Ledger from "../../domain/trust/ledger";
import { INVOICES, TRUST_ACCOUNTS } from "../../lib/data/billing";
import { CASES } from "../../lib/data/cases";
import { CLIENTS } from "../../lib/data/clients";
import { STAFF } from "../../lib/data/firm";
import { stableId } from "./ids";
import {
  AS_AT,
  CERTIFICATES,
  CLIENT_SUPPLEMENT,
  COURTS,
  MATTER_SUPPLEMENT,
  ROLE_ALIASES,
} from "./supplement";

/**
 * The wireframe's fixtures, turned into domain entities.
 *
 * This is the translation Phase 1 deferred, and it is worth being explicit
 * about why it could not have been written earlier: the prototype's data was
 * shaped by what a screen displays. A court is the string printed in a table
 * cell. A client's phone is whatever looked plausible. An invoice's status is a
 * tag, not a consequence of anything.
 *
 * The domain disagrees on all three, so the import is not a copy — it is a
 * decoding, and decoding can fail. Every entity below is built as plain data
 * and then run through its own schema, so a fixture that cannot satisfy the
 * domain is refused here rather than reaching Postgres and becoming a row
 * somebody trusts.
 *
 * Failures accumulate rather than short-circuiting. Someone fixing seed data
 * wants the whole list, not the first line of it.
 */

export class SeedProblem extends Schema.TaggedError<SeedProblem>()(
  "SeedProblem",
  { record: Schema.String, detail: Schema.String },
) {
  get reason(): string {
    return `${this.record}: ${this.detail}`;
  }
}

type Outcome<A> = Either.Either<readonly A[], readonly SeedProblem[]>;

/** Splits successes from failures, keeping every failure. */
const collect = <A>(
  results: readonly Either.Either<A, SeedProblem>[],
): Outcome<A> => {
  const problems = results.filter(Either.isLeft).map((result) => result.left);
  return problems.length > 0
    ? Either.left(problems)
    : Either.right(
        results.filter(Either.isRight).map((result) => result.right),
      );
};

/** A schema refusal, restated against the record it came from. */
const decoding =
  <A, I>(schema: Schema.Schema<A, I>, record: string) =>
  (raw: unknown): Either.Either<A, SeedProblem> =>
    Either.mapLeft(
      Schema.decodeUnknownEither(schema)(raw),
      (error) => new SeedProblem({ record, detail: error.message }),
    );

// ── Dates ─────────────────────────────────────────────────────────────────

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * `"14 Feb 2026"` — the only date format the prototype uses.
 *
 * Returns `undefined` rather than an Invalid Date, so a caller cannot forget to
 * check. `Date.parse` would accept this string on most runtimes and quietly
 * apply the local zone, which is how a filing date moves a day.
 */
export const parsePrototypeDate = (text: string): Date | undefined => {
  const match = /^(\d{1,2}) ([A-Z][a-z]{2}) (\d{4})$/.exec(text.trim());
  if (match === null) return undefined;

  const [, day, month, year] = match as unknown as [
    string,
    string,
    string,
    string,
  ];
  const index = MONTHS.indexOf(month as (typeof MONTHS)[number]);
  if (index < 0) return undefined;

  const date = new Date(Date.UTC(Number(year), index, Number(day)));
  return date.getUTCDate() === Number(day) ? date : undefined;
};

const shiftDays = (from: Date, days: number) =>
  new Date(from.getTime() + days * 24 * 60 * 60 * 1000);

const shillings = (amount: number) => amount * 100;

// ── Staff ─────────────────────────────────────────────────────────────────

/**
 * `"Adv. Sarah Wanjiru"` → `sarah.wanjiru@oklaw.co.ke`,
 * `"Legal Assistant - Mercy"` → `mercy@oklaw.co.ke`.
 *
 * The prototype's staff list carries a title where a real record carries a
 * name, so the title is stripped rather than turned into part of an address.
 */
export const firmEmail = (name: string): string => {
  const bare = name.includes(" - ")
    ? (name.split(" - ")[1] ?? name)
    : name.replace(/^Adv\.\s*/, "");

  return `${bare.trim().toLowerCase().replace(/\s+/g, ".")}@oklaw.co.ke`;
};

export const advocates = (): Outcome<Advocate.Advocate> =>
  collect(
    STAFF.map((member) => {
      const certificate = CERTIFICATES[member.name];
      const admittedOn =
        certificate === undefined
          ? undefined
          : new Date(`${certificate.admittedOn}T00:00:00.000Z`);

      return decoding(
        Advocate.Advocate,
        member.name,
      )({
        id: stableId("advocate", member.name),
        name: member.name,
        role: ROLE_ALIASES[member.role] ?? member.role,
        email: firmEmail(member.name),
        active: true,
        ...(certificate === undefined
          ? {}
          : {
              practisingCertificate: {
                number: certificate.number,
                year: certificate.year,
              },
            }),
        ...(admittedOn === undefined ? {} : { admittedOn }),
      });
    }),
  );

// ── Clients ───────────────────────────────────────────────────────────────

/** `"Peter Kamau (CFO)"` → the person and the capacity they act in. */
export const parseContact = (
  text: string,
): { readonly name: string; readonly role: string } => {
  const match = /^(.*?)\s*\((.+)\)\s*$/.exec(text.trim());
  return match === null
    ? { name: text.trim(), role: "Primary contact" }
    : {
        name: (match[1] ?? "").trim(),
        role: (match[2] ?? "").trim(),
      };
};

/**
 * The prototype's integer client key → the uuid it will be stored under.
 *
 * Derivable without decoding anything, because `stableId` is a pure function of
 * the key. That is what lets a matter reference its client before either has
 * been written, and it is the whole reason the ids are derived rather than
 * generated.
 */
export const clientIdsByPrototypeKey = (): ReadonlyMap<number, string> =>
  new Map(CLIENTS.map((client) => [client.id, stableId("client", client.id)]));

export const clients = (): Outcome<ClientDomain.Client> =>
  collect(
    CLIENTS.map((client) => {
      const extra = CLIENT_SUPPLEMENT[client.number];
      if (extra === undefined) {
        return Either.left(
          new SeedProblem({
            record: client.number,
            detail:
              "no entry in CLIENT_SUPPLEMENT; the wireframe records no KRA " +
              "PIN or onboarding date, and neither may be invented per-record",
          }),
        );
      }

      const contact = parseContact(client.contact);
      const shared = {
        id: stableId("client", client.id),
        number: client.number,
        name: client.name,
        email: client.email,
        phone: normalisePhone(client.phone),
        kraPin: extra.kraPin,
        onboardedOn: new Date(`${extra.onboardedOn}T00:00:00.000Z`),
      };

      return decoding(
        ClientDomain.Client,
        client.number,
      )(
        client.type === "individual"
          ? { _tag: "Individual", ...shared }
          : {
              _tag: "Corporate",
              ...shared,
              contacts: [{ name: contact.name, role: contact.role }],
            },
      );
    }),
  );

// ── Matters ───────────────────────────────────────────────────────────────

export const matters = (
  clientIds: ReadonlyMap<number, string>,
  advocateIds: ReadonlyMap<string, string>,
): Outcome<Matter.Case> =>
  collect(
    CASES.map((legalCase) => {
      const fail = (detail: string) =>
        Either.left(new SeedProblem({ record: legalCase.number, detail }));

      const filed = parsePrototypeDate(legalCase.filed);
      if (filed === undefined) {
        return fail(
          `filing date ${JSON.stringify(legalCase.filed)} is not a date`,
        );
      }

      // A name absent from COURTS is a failure. Defaulting would put a matter
      // in a court that may not be able to hear it, and then print a confident
      // jurisdiction check beside it.
      if (!(legalCase.court in COURTS)) {
        return fail(
          `court ${JSON.stringify(legalCase.court)} is not in the COURTS table`,
        );
      }
      const court = COURTS[legalCase.court];

      const clientId = clientIds.get(legalCase.clientId);
      if (clientId === undefined) {
        return fail(`no seeded client with prototype id ${legalCase.clientId}`);
      }

      const advocateId = advocateIds.get(legalCase.advocate);
      if (advocateId === undefined) {
        return fail(`no seeded advocate named ${legalCase.advocate}`);
      }

      const extra = MATTER_SUPPLEMENT[legalCase.number];
      if (extra === undefined) {
        return fail(
          "no entry in MATTER_SUPPLEMENT; the wireframe records only a filing " +
            "date, and the date the file was opened may not be invented per-record",
        );
      }

      const openedOn = new Date(`${extra.openedOn}T00:00:00.000Z`);
      if (openedOn.getTime() > filed.getTime()) {
        return fail(
          `opened on ${extra.openedOn} but filed on ${legalCase.filed}, which ` +
            "is backwards",
        );
      }

      return decoding(
        Matter.Case,
        legalCase.number,
      )({
        id: stableId("case", legalCase.id),
        number: legalCase.number,
        title: legalCase.title,
        type: legalCase.type,
        status: legalCase.status,
        clientId,
        advocateId,
        underCustomaryLaw: false,
        openedOn,
        filedOn: filed,
        ...(court === null ? {} : { court }),
        ...(extra.causeNumber === undefined
          ? {}
          : { causeNumber: extra.causeNumber }),
        ...(extra.claimValueShillings === undefined
          ? {}
          : { claimValueCents: shillings(extra.claimValueShillings) }),
        ...(extra.accruedOn === undefined
          ? {}
          : { accruedOn: new Date(`${extra.accruedOn}T00:00:00.000Z`) }),
        ...(extra.limitationBasis === undefined
          ? {}
          : { limitationBasis: extra.limitationBasis }),
      });
    }),
  );

// ── Invoices ──────────────────────────────────────────────────────────────

/**
 * Payment dates and a due date chosen to reproduce the prototype's status.
 *
 * The prototype stores `status: "Overdue"` as a fact. The domain derives it
 * from what has been paid and what the date is, so the import has to work
 * backwards: an overdue invoice is one with a due date behind `AS_AT` and
 * nothing paid against it. The assertion at the end of `invoices` is what
 * stops this quietly producing something else.
 */
const schedule = (status: string) =>
  status === "Overdue"
    ? { issuedOn: shiftDays(AS_AT, -60), dueOn: shiftDays(AS_AT, -30) }
    : { issuedOn: shiftDays(AS_AT, -20), dueOn: shiftDays(AS_AT, 10) };

export const invoices = (
  clientIdsByName: ReadonlyMap<string, string>,
  caseIdsByNumber: ReadonlyMap<string, string>,
): Outcome<Billing.Invoice> =>
  collect(
    INVOICES.map((invoice) => {
      const fail = (detail: string) =>
        Either.left(new SeedProblem({ record: invoice.number, detail }));

      const clientId = clientIdsByName.get(invoice.client);
      if (clientId === undefined) {
        return fail(`no seeded client named ${invoice.client}`);
      }

      const caseId = caseIdsByNumber.get(invoice.case);
      if (caseId === undefined) {
        return fail(`no seeded matter numbered ${invoice.case}`);
      }

      // The prototype splits each invoice 80/20 with a float multiply. Whole
      // shillings survive that; anything else must not become a rounded cent.
      const lines = invoice.lineItems.map((item) => ({
        description: item.desc,
        quantityHundredths: Math.round(item.qty * 100),
        unitPriceCents: shillings(item.rate),
      }));

      const fractional = lines.find(
        (line) => !Number.isInteger(line.unitPriceCents),
      );
      if (fractional !== undefined) {
        return fail(
          `line "${fractional.description}" prices at ${fractional.unitPriceCents} ` +
            `cents, which is not a whole cent`,
        );
      }

      const { issuedOn, dueOn } = schedule(invoice.status);
      const total = Money.fromCents(shillings(invoice.amount));

      const settled =
        invoice.status === "Paid"
          ? [total]
          : invoice.status === "Partially Paid"
            ? [Money.allocate(total, 2)[0] ?? Money.zero]
            : [];

      const decoded = decoding(
        Billing.Invoice,
        invoice.number,
      )({
        id: stableId("invoice", invoice.id),
        number: invoice.number,
        clientId,
        caseId,
        issuedOn,
        dueOn,
        lines,
        payments: settled.map((amount) => ({
          amountCents: amount,
          method: invoice.method,
          receivedOn: shiftDays(issuedOn, 10),
          reference: `${invoice.number}/1`,
        })),
      });

      if (Either.isLeft(decoded)) return decoded;

      // The prototype's tag and the domain's derivation must agree, or the
      // seeded demo says one thing and the code says another.
      const derived = Billing.status(decoded.right, AS_AT);
      if (derived !== invoice.status) {
        return fail(
          `prototype says ${invoice.status}, but the domain derives ` +
            `${derived} from the seeded lines and payments`,
        );
      }

      return decoded;
    }),
  );

// ── Trust ledger ──────────────────────────────────────────────────────────

/**
 * Deposits and withdrawals, in that order.
 *
 * The prototype stores a pair of running totals per client. The ledger stores
 * movements and derives the balance, so the totals have to become entries —
 * and the deposit has to be recorded before the withdrawal, or Rule 10 refuses
 * the withdrawal against a balance of nothing. That ordering is not a detail
 * of the import; it is the rule.
 */
export const trustMovements = (
  clientIdsByName: ReadonlyMap<string, string>,
): Outcome<Ledger.TrustMovement> =>
  collect(
    TRUST_ACCOUNTS.flatMap((account) => {
      const clientId = clientIdsByName.get(account.client);
      if (clientId === undefined) {
        return [
          Either.left(
            new SeedProblem({
              record: account.client,
              detail: "holds trust money but is not a seeded client",
            }),
          ),
        ];
      }

      const entries = [
        {
          id: stableId("trust-deposit", account.client),
          clientId,
          reason: "Deposit received",
          amount: shillings(account.deposits),
          recordedAt: shiftDays(AS_AT, -40),
          reference: "Client deposit",
        },
        {
          id: stableId("trust-withdrawal", account.client),
          clientId,
          reason: "Transfer to office account for costs",
          amount: shillings(account.withdrawals),
          recordedAt: shiftDays(AS_AT, -20),
          reference: "Costs drawn against fee note",
        },
      ].filter((entry) => entry.amount > 0);

      return entries.map(decoding(Ledger.TrustMovement, account.client));
    }),
  );
