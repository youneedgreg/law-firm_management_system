import { Either, Option, Schema } from "effect";
import * as Billing from "../../domain/billing/invoice";
import * as Matter from "../../domain/case/case";
import * as ClientDomain from "../../domain/client/client";
import * as Advocate from "../../domain/firm/advocate";
import { normalisePhone } from "../../domain/shared/ids";
import * as Money from "../../domain/shared/money";
import { normaliseName } from "../../domain/client/conflicts";
import * as Documents from "../../domain/document/document";
import * as Work from "../../domain/work/task";
import * as Correspondence from "../../domain/message/message";
import * as Log from "../../domain/firm/contact";
import * as Library from "../../domain/firm/precedent";
import * as Hearing from "../../domain/court/hearing";
import * as Ledger from "../../domain/trust/ledger";
import * as Time from "../../domain/time/entry";
import { INVOICES, TRUST_ACCOUNTS } from "../../lib/data/billing";
import { CASES } from "../../lib/data/cases";
import { DOCUMENTS } from "../../lib/data/documents";
import { TASKS } from "../../lib/data/work";
import { COMMUNICATIONS, KNOWLEDGE } from "../../lib/data/firm";
import { HEARINGS } from "../../lib/data/hearings";
import { TIME_ENTRIES } from "../../lib/data/work";
import { CLIENTS } from "../../lib/data/clients";
import { STAFF } from "../../lib/data/firm";
import { stableId } from "./ids";
import {
  AS_AT,
  CERTIFICATES,
  CLIENT_SUPPLEMENT,
  COURTS,
  FILED_WITH_COURT,
  MATTER_SUPPLEMENT,
  SIGNATURE_STATUSES_BY_PROTOTYPE,
  CONTACT_BACKDATED,
  CONTACT_DIRECTIONS,
  PRECEDENT_DATES,
  SEEDED_THREAD,
  TASK_ASSIGNEES,
  TASK_STATUSES_BY_PROTOTYPE,
  HEARING_KINDS_BY_ID,
  HOURLY_RATES,
  MPESA_CONFIRMATIONS,
  ROLE_ALIASES,
  TIME_NARRATIVES,
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
        opposingParties: opposingFromTitle(
          legalCase.title,
          CLIENTS.find((c) => c.id === legalCase.clientId)?.name ?? "",
        ),
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

/**
 * The opposing party, where the title names one.
 *
 * `"Wanjiku Mwangi v. Nairobi Metro SACCO"` genuinely encodes the other side,
 * so this reads it rather than inventing one — the difference between this and
 * `MPESA_CONFIRMATIONS` is that the information is *there*, in a shape a person
 * can read and a query cannot. Deriving it is recovering a fact the prototype
 * recorded badly, not supplying one it never had.
 *
 * Titles with no `v.` — `"General Innovations Ltd — KRA Tax Objection"`,
 * `"In re Estate of Njeri Kamau"` — return nothing, and that is right rather
 * than a shortfall: a tax objection is against the Commissioner and a probate
 * application is against nobody, and guessing either would put a name into the
 * conflict screen that the firm never recorded.
 *
 * `"Republic v. David Odhiambo"` is the interesting one. In a criminal defence
 * the firm acts for the *accused*, so the party on the other side is the
 * Republic — which is what this returns, correctly, by taking the side the
 * client is not on rather than assuming the client comes first.
 */
export const opposingFromTitle = (
  title: string,
  clientName: string,
): readonly string[] => {
  const parts = title.split(/\s+v\.?\s+/i);
  if (parts.length !== 2) return [];

  const [left, right] = parts as [string, string];
  const clientIsLeft =
    normaliseName(left) === normaliseName(clientName) ||
    normaliseName(left).includes(normaliseName(clientName));

  const other = (clientIsLeft ? right : left).trim();
  return other === "" ? [] : [other];
};

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

      /**
       * The reference a payment is reconciled by.
       *
       * For M-Pesa this is the Safaricom confirmation code and the domain
       * refuses a payment without one, so an unlisted M-Pesa fee note is a
       * failure rather than a fallback — see `MPESA_CONFIRMATIONS`. Every other
       * method keeps the prototype's synthetic reference, which is honest about
       * being one.
       */
      const confirmation = MPESA_CONFIRMATIONS[invoice.number];
      if (invoice.method === "M-Pesa" && confirmation === undefined) {
        return fail(
          `is paid by M-Pesa and has no confirmation code in ` +
            `MPESA_CONFIRMATIONS. An M-Pesa payment cannot be reconciled ` +
            `without one, and inventing a reference here is what that table ` +
            `exists to stop`,
        );
      }

      const reference = confirmation ?? `${invoice.number}/1`;

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
          reference,
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

// ── Recorded time ─────────────────────────────────────────────────────────

/**
 * The prototype's timesheet, decoded into `TimeEntry` values.
 *
 * Three gaps to close, and each one is closed by *failing* rather than
 * defaulting:
 *
 * - **The matter.** The prototype writes `"—"` for firm admin time, which has
 *   no matter at all. The domain requires one, because `TimeEntry.caseId` is
 *   not optional — recorded work belongs to a file. Those entries are dropped
 *   with a stated reason rather than attached to an arbitrary matter.
 * - **The rate.** Absent from the prototype entirely; supplied per fee-earner
 *   in `HOURLY_RATES`, and a missing entry is a failure. A default of zero
 *   would turn somebody's afternoon into free work without anyone noticing.
 * - **The narrative.** Also absent. `NonEmptyTrimmedString` refuses the empty
 *   string, which is right: the narrative is what a client reads when a bill is
 *   challenged, and "Drafting" is not a defensible description of three hours.
 *
 * The date is derived from `AS_AT` and the entry's position, because the
 * prototype records a start and an end time and no day at all. Spreading them
 * across the preceding fortnight is honest about being made up and produces a
 * timesheet that looks like a fortnight's work rather than six entries at
 * midnight.
 */
export const timeEntries = (
  caseIdsByNumber: ReadonlyMap<string, string>,
  advocateIdsByName: ReadonlyMap<string, string>,
): Outcome<Time.TimeEntry> =>
  collect(
    TIME_ENTRIES.flatMap((entry, index) => {
      const label = `time entry ${String(entry.id)}`;
      const fail = (detail: string) =>
        Either.left(new SeedProblem({ record: label, detail }));

      // Firm admin time with no matter. Recorded in the prototype, and the
      // domain has nowhere to put it — see the note above.
      if (entry.case === "—") return [];

      const caseId = caseIdsByNumber.get(entry.case);
      if (caseId === undefined) {
        return [fail(`no seeded matter numbered ${entry.case}`)];
      }

      const advocateId = advocateIdsByName.get(entry.lawyer);
      if (advocateId === undefined) {
        return [fail(`no seeded staff member named ${entry.lawyer}`)];
      }

      const rate = HOURLY_RATES[entry.lawyer];
      if (rate === undefined) {
        return [
          fail(
            `has no hourly rate in HOURLY_RATES. A rate of zero would bill ` +
              `this work at nothing, so the import refuses rather than guesses`,
          ),
        ];
      }

      const narrative = TIME_NARRATIVES[entry.id];
      if (narrative === undefined) {
        return [
          fail(
            `has no narrative in TIME_NARRATIVES. The narrative is what a ` +
              `client reads if the bill is challenged`,
          ),
        ];
      }

      return [
        decoding(
          Time.TimeEntry,
          label,
        )({
          id: stableId("time", String(entry.id)),
          caseId,
          advocateId,
          activity:
            entry.activity === "Admin" ? "Administration" : entry.activity,
          minutes: Math.round(entry.hours * 60),
          workedOn: shiftDays(AS_AT, -(14 - index)),
          billable: entry.billable,
          hourlyRateCents: shillings(rate),
          narrative,
          /**
           * The *encoded* form, because `decoding` runs
           * `decodeUnknownEither` — it takes what the wire or the database
           * would carry, not the in-memory value. `Schema.Option` encodes to
           * the tagged shape, so `Option.none()` is refused here and rightly:
           * this fixture is untrusted input like any other.
           */
          invoicedOn: { _tag: "None" },
        }),
      ];
    }),
  );

// ── Court dates ───────────────────────────────────────────────────────────

/**
 * `"9:00 AM"` on a day, as an instant.
 *
 * The prototype stores a date and a time as two display strings. A hearing is a
 * moment, and `hearings.scheduled_for` is a `timestamptz` — so the two have to
 * be combined, and the combination is where a court date can silently move.
 *
 * Composed as UTC deliberately, matching every other date the seed writes.
 * Nairobi is UTC+3 with no daylight saving, so a real deployment would want
 * `Africa/Nairobi` and this would be the place to put it; writing the seed in
 * one zone and the application in another is how a 9 a.m. mention becomes a
 * 6 a.m. one on somebody's screen.
 */
const atTime = (day: Date, time: string): Date | undefined => {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(time.trim());
  if (match === null) return undefined;

  const [, rawHour, minute, meridiem] = match as unknown as [
    string,
    string,
    string,
    string,
  ];

  const hour = Number(rawHour) % 12;
  const hours = meridiem.toUpperCase() === "PM" ? hour + 12 : hour;

  return new Date(
    Date.UTC(
      day.getUTCFullYear(),
      day.getUTCMonth(),
      day.getUTCDate(),
      hours,
      Number(minute),
    ),
  );
};

/**
 * The prototype's court diary, decoded into `Hearing` values.
 *
 * Three things the prototype does not have, and each is refused rather than
 * defaulted:
 *
 * - **A court that knows its own jurisdiction.** The free-text name resolves
 *   through `COURTS`, the same table intake uses. A hearing before the Tax
 *   Appeals Tribunal — mapped to `null` there, because it is constituted under
 *   its own Act and is not in the Article 162 hierarchy — cannot be a
 *   `Hearing`, whose `court` is required. That is refused with a stated reason
 *   rather than assigned to a court it is not before.
 * - **A kind.** The prototype records a `status` of "Confirmed" or "Tentative",
 *   which is about the listing rather than about what the court will do.
 *   `HEARING_KINDS` is supplied per fixture in `HEARING_KINDS_BY_ID`.
 * - **An outcome.** Every seeded hearing is upcoming, so all of them are
 *   unrecorded — which is correct, and is what puts them on the diary.
 */
export const hearings = (
  caseIdsByPrototypeId: ReadonlyMap<number, string>,
  advocateIdsByName: ReadonlyMap<string, string>,
): Outcome<Hearing.Hearing> =>
  collect(
    HEARINGS.flatMap((hearing) => {
      const label = `hearing ${String(hearing.id)}`;
      const fail = (detail: string) =>
        Either.left(new SeedProblem({ record: label, detail }));

      const caseId = caseIdsByPrototypeId.get(hearing.caseId);
      if (caseId === undefined) {
        return [
          fail(`no seeded matter with prototype id ${String(hearing.caseId)}`),
        ];
      }

      const advocateId = advocateIdsByName.get(hearing.advocate);
      if (advocateId === undefined) {
        return [fail(`no seeded advocate named ${hearing.advocate}`)];
      }

      if (!(hearing.court in COURTS)) {
        return [fail(`court "${hearing.court}" is not in the COURTS table`)];
      }

      const court = COURTS[hearing.court];
      if (court === null || court === undefined) {
        return [
          fail(
            `is listed before ${hearing.court}, which is not a court in the ` +
              `Article 162 hierarchy. A Hearing requires one, so this fixture ` +
              `is refused rather than assigned to a court it is not before`,
          ),
        ];
      }

      const day = parsePrototypeDate(hearing.date);
      if (day === undefined) {
        return [fail(`cannot read the date "${hearing.date}"`)];
      }

      const scheduledFor = atTime(day, hearing.time);
      if (scheduledFor === undefined) {
        return [fail(`cannot read the time "${hearing.time}"`)];
      }

      const kind = HEARING_KINDS_BY_ID[hearing.id];
      if (kind === undefined) {
        return [
          fail(
            `has no entry in HEARING_KINDS_BY_ID. The prototype records a ` +
              `listing status, not what the court will do`,
          ),
        ];
      }

      return [
        decoding(
          Hearing.Hearing,
          label,
        )({
          id: stableId("hearing", String(hearing.id)),
          caseId,
          kind,
          court,
          scheduledFor,
          advocateId,
          ...(hearing.room === "" ? {} : { room: hearing.room }),
        }),
      ];
    }),
  );

// ── Documents ─────────────────────────────────────────────────────────────

/**
 * A placeholder body for a seeded document.
 *
 * The prototype has document *records* and no bytes at all. Seeding the rows
 * alone would produce exactly the failure the upload path is arranged to
 * avoid: a row saying a document exists, a storage key pointing at nothing,
 * and a download that fails the moment anyone clicks it. So the seed generates
 * a body and uploads it.
 *
 * It is a real object of a real size, and it says on its face that it is a
 * placeholder — which is the difference between demo data that is honest about
 * being demo data and demo data that pretends to be a plaint.
 */
export const placeholderFor = (
  document: { readonly name: string; readonly category: string },
  matterNumber: string,
  version: number,
): Uint8Array =>
  new TextEncoder().encode(
    [
      "OKLAW — SEEDED PLACEHOLDER",
      "",
      `Document: ${document.name}`,
      `Category: ${document.category}`,
      `Matter:   ${matterNumber}`,
      `Version:  ${String(version)}`,
      "",
      "Generated by `npm run db:seed`. This is not a legal document and its",
      "contents are meaningless. It exists so that every row in the document",
      "register points at an object that actually exists — a row with no",
      "object behind it is the one failure the upload path is arranged to",
      "prevent, and seeding rows without bodies would manufacture it.",
      "",
    ].join("\n"),
  );

/** A decoded document together with the bodies its versions promise. */
export type SeededDocument = {
  readonly document: Documents.Document;
  readonly bodies: readonly {
    readonly key: string;
    readonly body: Uint8Array;
  }[];
};

/**
 * The prototype's document register, decoded into `Document` values.
 *
 * Three things the prototype does not have are supplied here, and each is
 * marked as supplied rather than defaulted:
 *
 * - **Filing.** `filedWithCourt` is what makes a document *fixed*, so
 *   defaulting it to `false` would quietly assert the firm has never filed
 *   anything. `FILED_WITH_COURT` says which ones went to court.
 * - **Signature status.** The prototype's vocabulary is not the domain's — it
 *   says "Pending signature" and, for a judgment, "Final". The mapping is a
 *   table, and an unrecognised status is refused rather than guessed.
 * - **Version history.** The prototype has a version *count* and a fabricated
 *   `versions` array whose second entry is dated `"earlier draft"` — not a
 *   date. The count is the only real datum, so versions are synthesised
 *   backwards from the recorded date, a week apart, attributed to the matter's
 *   own advocate. One version per document would leave `currentVersion` and
 *   the append-only rule untested against real data.
 *
 * `storageKey` is derived exactly as `DocumentService` derives it, so a seeded
 * document and an uploaded one are indistinguishable to everything downstream.
 */
export const documents = (
  caseIdsByNumber: ReadonlyMap<string, string>,
  advocateIdsByName: ReadonlyMap<string, string>,
): Outcome<SeededDocument> =>
  collect(
    DOCUMENTS.map((entry): Either.Either<SeededDocument, SeedProblem> => {
      const label = `document ${String(entry.id)}`;
      const fail = (detail: string) =>
        Either.left(new SeedProblem({ record: label, detail }));

      const caseId = caseIdsByNumber.get(entry.case);
      if (caseId === undefined) {
        return fail(`no seeded matter numbered ${entry.case}`);
      }

      const carriedBy = CASES.find(
        (legalCase) => legalCase.number === entry.case,
      )?.advocate;
      const uploadedBy =
        carriedBy === undefined ? undefined : advocateIdsByName.get(carriedBy);
      if (uploadedBy === undefined) {
        return fail(`cannot resolve who carries ${entry.case}`);
      }

      const recorded = parsePrototypeDate(entry.date);
      if (recorded === undefined) {
        return fail(`cannot read the date "${entry.date}"`);
      }

      const signatureStatus = SIGNATURE_STATUSES_BY_PROTOTYPE.get(
        entry.sigStatus,
      );
      if (signatureStatus === undefined) {
        return fail(
          `no signature status recorded for "${entry.sigStatus}" — add it to ` +
            `SIGNATURE_STATUSES_BY_PROTOTYPE rather than guessing`,
        );
      }

      const id = stableId("document", entry.id);

      // The bodies first, because the size on a version is a fact about them.
      const bodies = Array.from({ length: entry.version }, (_, index) => ({
        key: `matters/${caseId}/${id}/v${String(index + 1)}`,
        body: placeholderFor(entry, entry.case, index + 1),
      }));

      const versions = bodies.map((stored, index) => {
        const number = index + 1;

        return {
          number,
          storageKey: stored.key,
          /**
           * The length of the body that will actually be stored, not a
           * plausible-looking figure.
           *
           * This invented a size — forty-odd kilobytes, varied per document so
           * the register would not show one suspicious number on every row —
           * and the register then displayed "65 KB" beside an object of 467
           * bytes. Nothing in the type system objects to a row that lies about
           * its own object, and no test that stopped at the row could see it;
           * it took fetching every seeded document from the real store and
           * comparing.
           *
           * `sizeBytes` is a fact about the bytes, so it comes from the bytes.
           * `DocumentStore.put` returns the size it stored for the same
           * reason, and `upload` uses that rather than trusting the caller.
           */
          sizeBytes: stored.body.byteLength,
          uploadedBy,
          uploadedOn: shiftDays(recorded, -(entry.version - number) * 7),
        };
      });

      return Either.flatMap(
        decoding(
          Documents.Document,
          label,
        )({
          id,
          caseId,
          name: entry.name,
          category: entry.category,
          signatureStatus,
          filedWithCourt: FILED_WITH_COURT.has(entry.id),
          versions,
        }),
        (document) =>
          Either.right({
            document,
            bodies: versions.map((version) => ({
              key: version.storageKey,
              body: placeholderFor(entry, entry.case, version.number),
            })),
          }),
      );
    }),
  );

// ── Work ──────────────────────────────────────────────────────────────────

/**
 * The prototype's task list, decoded into `Task` values.
 *
 * Two gaps closed by supplement and one by derivation.
 *
 * The **status vocabulary** differs — the prototype's `Scheduled` is not a
 * state of the work — and an unrecognised one stops the import rather than
 * defaulting to `Not started`, which would silently un-do work somebody had
 * begun. The **assignee** may name somebody the prototype's own staff list does
 * not contain, which is a real inconsistency in the fixtures and is resolved by
 * a recorded decision rather than a fallback; see `TASK_ASSIGNEES`.
 *
 * `raisedOn` is **derived**: the prototype records only a due date, and the
 * domain refuses a task due before it was raised. A week before the due date is
 * a plausible working assumption and is marked as one here — the alternative is
 * raising everything on the day the seed runs, which would make every task look
 * new and leave `raisedOn` meaningless.
 *
 * A `case` of `"—"` becomes firm work with no matter, which is the case this
 * module's `Option` exists for. Compare the time adapter, which *drops* the
 * equivalent row: unattributed time has nowhere to go, and unattributed work is
 * just work.
 */
export const tasks = (
  caseIdsByNumber: ReadonlyMap<string, string>,
  advocateIdsByName: ReadonlyMap<string, string>,
): Outcome<Work.Task> =>
  collect(
    TASKS.map((entry): Either.Either<Work.Task, SeedProblem> => {
      const label = `task ${String(entry.id)}`;
      const fail = (detail: string) =>
        Either.left(new SeedProblem({ record: label, detail }));

      const dueOn = parsePrototypeDate(entry.due);
      if (dueOn === undefined) {
        return fail(`cannot read the due date "${entry.due}"`);
      }

      const status = TASK_STATUSES_BY_PROTOTYPE.get(entry.status);
      if (status === undefined) {
        return fail(
          `no domain status recorded for "${entry.status}" — add it to ` +
            `TASK_STATUSES_BY_PROTOTYPE rather than guessing`,
        );
      }

      const assigneeName = TASK_ASSIGNEES.get(entry.assignee) ?? entry.assignee;
      const assignedTo = advocateIdsByName.get(assigneeName);
      if (assignedTo === undefined) {
        return fail(
          `"${entry.assignee}" is not on the firm's staff list. A task ` +
            `assigned to somebody who is not there is a task nobody is doing ` +
            `— add them to TASK_ASSIGNEES if they are somebody under another ` +
            `name`,
        );
      }

      // Firm work: the prototype writes an em dash where there is no matter.
      const caseId =
        entry.case === "—" ? undefined : caseIdsByNumber.get(entry.case);
      if (entry.case !== "—" && caseId === undefined) {
        return fail(`no seeded matter numbered ${entry.case}`);
      }

      /**
       * Done tasks need a completion record, and the prototype has none — no
       * date and no name. None of its tasks are `Done`, so nothing here has to
       * invent one; if one ever is, the import stops rather than attributing a
       * completion to somebody who may not have made it.
       */
      if (status === "Done") {
        return fail(
          `the prototype records this as done and says nothing about when or ` +
            `by whom, and a completion attributed to a guess is worse than no ` +
            `completion`,
        );
      }

      /**
       * `typeSchema`, not the schema itself.
       *
       * `caseId` and `completed` are `Schema.Option`, which is a *transform*:
       * its encoded side is `{ _tag: "Some", value }`, and this adapter builds
       * real `Option` values. Decoding against the transform asks for the JSON
       * shape and fails on all eight rows at once — which is what happened, and
       * is the sort of thing that would otherwise have been discovered by the
       * seed script rather than by a test.
       */
      return decoding(
        Schema.typeSchema(Work.Task),
        label,
      )({
        id: stableId("task", entry.id),
        title: entry.title,
        caseId: caseId === undefined ? Option.none() : Option.some(caseId),
        assignedTo,
        priority: entry.priority,
        status,
        raisedOn: shiftDays(dueOn, -7),
        dueOn,
        completed: Option.none(),
      });
    }),
  );

// ── Correspondence ────────────────────────────────────────────────────────

/**
 * The seeded client threads.
 *
 * Supplied rather than adapted — the prototype has no messages, only a contact
 * log of calls and meetings, and importing that as correspondence would put
 * words in the firm's mouth. See `SEEDED_THREAD` for why the two are different
 * records.
 *
 * The firm's side is attributed to the advocate who carries the matter, or to
 * the managing partner for a general enquiry — somebody has to have written it,
 * and `author_is_consistent` will not accept a firm message with no name.
 */
export const messages = (
  clientIdsByNumber: ReadonlyMap<string, string>,
  caseIdsByNumber: ReadonlyMap<string, string>,
  advocateIdsByName: ReadonlyMap<string, string>,
): Outcome<Correspondence.Message> =>
  collect(
    SEEDED_THREAD.map(
      (entry, index): Either.Either<Correspondence.Message, SeedProblem> => {
        const label = `message ${String(index + 1)}`;
        const fail = (detail: string) =>
          Either.left(new SeedProblem({ record: label, detail }));

        const clientId = clientIdsByNumber.get(entry.clientNumber);
        if (clientId === undefined) {
          return fail(`no seeded client numbered ${entry.clientNumber}`);
        }

        const caseId =
          entry.matterNumber === undefined
            ? undefined
            : caseIdsByNumber.get(entry.matterNumber);
        if (entry.matterNumber !== undefined && caseId === undefined) {
          return fail(`no seeded matter numbered ${entry.matterNumber}`);
        }

        const sentAt = shiftDays(AS_AT, -entry.daysAgo);

        /**
         * Untyped on purpose: the ids in these maps are plain strings, and the
         * brands are applied by `decoding` below. Annotating this as an
         * `Author` would mean asserting a brand this function has not checked,
         * which is the cast the codebase does not allow outside a parsing
         * boundary — and the parsing boundary is three lines further down.
         */
        let author: unknown;
        if (entry.from === "client") {
          author = { _tag: "FromClient" };
        } else {
          /**
           * The advocate on the matter, or the managing partner when the
           * message names none — she is the one person guaranteed to be on
           * every seeded staff list. Refused rather than defaulted if neither can
           * be resolved: a firm message with nobody behind it is one the
           * database will reject anyway, and later.
           */
          const carriedBy =
            entry.matterNumber === undefined
              ? "Adv. Sarah Wanjiru"
              : CASES.find((each) => each.number === entry.matterNumber)
                  ?.advocate;
          const advocateId =
            carriedBy === undefined
              ? undefined
              : advocateIdsByName.get(carriedBy);

          if (advocateId === undefined) {
            return fail(
              `cannot resolve who at the firm sent this — a message from the ` +
                `firm has to name somebody`,
            );
          }
          author = { _tag: "FromFirm", advocateId };
        }

        return decoding(
          Schema.typeSchema(Correspondence.Message),
          label,
        )({
          id: stableId("message", index + 1),
          clientId,
          caseId: caseId === undefined ? Option.none() : Option.some(caseId),
          author,
          body: entry.body,
          sentAt,
          // Read shortly after it was sent, which is what actually happens.
          readAt: entry.read
            ? Option.some(new Date(sentAt.getTime() + 45 * 60 * 1000))
            : Option.none(),
        });
      },
    ),
  );

// ── The firm's own records ────────────────────────────────────────────────

/**
 * The prototype's contact log, decoded into `Contact` values.
 *
 * This is the log the messaging slice deliberately refused to import as
 * correspondence — "Discussed plea strategy" on a phone call is a note somebody
 * made, not something typed to a client — and here it lands where it belongs.
 *
 * Two gaps. **Direction** the prototype does not record, and it is the first
 * question anybody asks a contact log; it is supplied per entry in
 * `CONTACT_DIRECTIONS` rather than defaulted to `Outgoing`, which would claim
 * the firm initiated every conversation it ever had. **Who logged it** is not
 * recorded either, and is taken from the advocate carrying that client's
 * matter — stated here rather than silently attributed to the managing partner.
 */
export const contacts = (
  clientIdsByName: ReadonlyMap<string, string>,
  caseIdsByNumber: ReadonlyMap<string, string>,
  advocateIdsByName: ReadonlyMap<string, string>,
): Outcome<Log.Contact> =>
  collect(
    COMMUNICATIONS.map((entry): Either.Either<Log.Contact, SeedProblem> => {
      const label = `communication ${String(entry.id)}`;
      const fail = (detail: string) =>
        Either.left(new SeedProblem({ record: label, detail }));

      const clientId = clientIdsByName.get(entry.with);
      if (clientId === undefined) {
        return fail(`no seeded client named ${entry.with}`);
      }

      /**
       * The supplement's date where there is one, otherwise the prototype's.
       * See `CONTACT_BACKDATED` — two entries are moved back so the neglect
       * report has something to report.
       */
      const stated = CONTACT_BACKDATED.get(entry.id) ?? entry.date;
      const occurredOn = parsePrototypeDate(stated);
      if (occurredOn === undefined) {
        return fail(`cannot read the date "${stated}"`);
      }

      const direction = CONTACT_DIRECTIONS.get(entry.id);
      if (direction === undefined) {
        return fail(
          `no direction recorded — add ${String(entry.id)} to ` +
            `CONTACT_DIRECTIONS rather than assuming the firm made the call`,
        );
      }

      /**
       * Attributed to whoever carries a matter for this client. A contact
       * log entry has to name somebody: `logged_by` is `NOT NULL`, and a
       * note nobody wrote is a note nobody can be asked about.
       *
       * Matched through the prototype's own integer `clientId` rather than
       * by name — the prototype's `CASES` does not carry a client name at
       * all, and matching on the matter *title* would attach a General
       * Innovations conversation to the Zenith matter whenever the title
       * happened to mention both.
       */
      const theirMatter = CASES.find(
        (legalCase) =>
          clientIdsByPrototypeKey().get(legalCase.clientId) === clientId,
      );
      const loggedBy =
        theirMatter === undefined
          ? undefined
          : advocateIdsByName.get(theirMatter.advocate);

      if (loggedBy === undefined) {
        return fail(
          `cannot resolve who at the firm had this conversation — a note ` +
            `has to name somebody`,
        );
      }

      return decoding(
        Schema.typeSchema(Log.Contact),
        label,
      )({
        id: stableId("contact", entry.id),
        clientId,
        caseId:
          theirMatter === undefined
            ? Option.none()
            : Option.fromNullable(caseIdsByNumber.get(theirMatter.number)),
        channel: entry.channel,
        direction,
        loggedBy,
        summary: entry.summary,
        occurredOn,
      });
    }),
  );

/**
 * The prototype's knowledge base, decoded into `Precedent` values.
 *
 * The prototype's `date` is a *string* — `"Updated Jan 2026"` — which is a
 * label rather than a date, and the domain needs two real ones: when it was
 * filed, and when it was last checked. `PRECEDENT_DATES` supplies both, and the
 * important half is that some entries have **no review date at all**: a
 * precedent nobody has verified since it was filed is exactly the one to be
 * careful of, and defaulting `reviewedOn` to `addedOn` would record a review
 * that never happened.
 */
export const precedents = (
  advocateIdsByName: ReadonlyMap<string, string>,
): Outcome<Library.Precedent> =>
  collect(
    KNOWLEDGE.map((entry): Either.Either<Library.Precedent, SeedProblem> => {
      const label = `knowledge entry ${String(entry.id)}`;
      const fail = (detail: string) =>
        Either.left(new SeedProblem({ record: label, detail }));

      const supplied = PRECEDENT_DATES.get(entry.id);
      if (supplied === undefined) {
        return fail(
          `the prototype's "${entry.date}" is a label, not a date — add ` +
            `${String(entry.id)} to PRECEDENT_DATES`,
        );
      }

      const addedOn = parsePrototypeDate(supplied.added);
      if (addedOn === undefined) {
        return fail(`cannot read the filing date "${supplied.added}"`);
      }

      const reviewedOn =
        supplied.reviewed === undefined
          ? undefined
          : parsePrototypeDate(supplied.reviewed);
      if (supplied.reviewed !== undefined && reviewedOn === undefined) {
        return fail(`cannot read the review date "${supplied.reviewed}"`);
      }

      const addedBy = advocateIdsByName.get(supplied.addedBy);
      if (addedBy === undefined) {
        return fail(`no seeded advocate named ${supplied.addedBy}`);
      }

      return decoding(
        Schema.typeSchema(Library.Precedent),
        label,
      )({
        id: stableId("precedent", entry.id),
        title: entry.title,
        category: entry.category,
        location: supplied.location,
        addedBy,
        addedOn,
        reviewedOn: Option.fromNullable(reviewedOn),
        ...(supplied.note === undefined ? {} : { note: supplied.note }),
      });
    }),
  );
