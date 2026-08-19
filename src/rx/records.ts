import { Schema } from "effect";
import {
  ACCOUNT_STATUSES,
  APPOINTMENT_TYPES,
  COMMUNICATION_CHANNELS,
  CURRENCIES,
  DATE_FORMATS,
  DOCUMENT_CATEGORIES,
  HEARING_STATUSES,
  INVOICE_STATUSES,
  PAYMENT_METHODS,
  PRIORITIES,
  ROLES,
  SIGNATURE_STATUSES,
  TASK_STATUSES,
  TIMEZONES,
  TIME_ACTIVITIES,
  type Appointment,
  type Client,
  type Communication,
  type FirmDocument,
  type FirmSettings,
  type FirmTask,
  type Hearing,
  type Invoice,
  type PortalMessage,
  type Role,
  type TimeEntry,
  type UserAccount,
} from "../lib/types";

/**
 * The session store, as schemas.
 *
 * Everything here describes what the browser keeps for itself: the role being
 * played, the firm's preferences, and the records the prototype's forms create
 * for modules that have no backend yet. It is written as schemas because it is
 * read back out of `localStorage`, and a string from `localStorage` is exactly
 * as trustworthy as a string from a network — it was written by a previous
 * version of this app, or by a user with a console open, or by nothing at all.
 *
 * The module this replaced took the honest but limited position that a stored
 * list is a list if `Array.isArray` says so. That admits a `Hearing` with no
 * date and a `Role` this build has never heard of, and the screen that renders
 * one is where the problem is found. Decoding through these means a record that
 * does not fit is refused at the boundary, which is the same rule the rest of
 * the codebase follows for rows and requests.
 *
 * ## Why it is written out rather than derived
 *
 * `lib/types.ts` holds interfaces, not schemas, so there is nothing to derive
 * from — the wireframe's types predate the domain. `RECORDS_MATCH_TYPES` at the
 * bottom is the substitute: each schema must decode to exactly its interface,
 * so a field added to one and not the other fails to compile. When Phase 7
 * migrates one of these modules to real endpoints, both the interface and the
 * schema go, together.
 */

type Identical<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

/** The mock data's ids are small integers assigned in the browser. */
const Id = Schema.Int;

export const RoleSchema: Schema.Schema<Role> = Schema.Literal(...ROLES);

// ── The records the forms create ──────────────────────────────────────────

const ClientSchema = Schema.mutable(
  Schema.Struct({
    id: Id,
    number: Schema.String,
    name: Schema.String,
    type: Schema.Literal("individual", "corporate"),
    contact: Schema.String,
    email: Schema.String,
    phone: Schema.String,
    activeCases: Schema.Int,
    conflictStatus: Schema.String,
  }),
);

const HearingSchema = Schema.mutable(
  Schema.Struct({
    id: Id,
    caseId: Id,
    caseTitle: Schema.String,
    court: Schema.String,
    room: Schema.String,
    date: Schema.String,
    time: Schema.String,
    judge: Schema.String,
    advocate: Schema.String,
    status: Schema.Literal(...HEARING_STATUSES),
  }),
);

const TaskSchema = Schema.mutable(
  Schema.Struct({
    id: Id,
    title: Schema.String,
    case: Schema.String,
    assignee: Schema.String,
    priority: Schema.Literal(...PRIORITIES),
    due: Schema.String,
    status: Schema.Literal(...TASK_STATUSES),
  }),
);

const TimeEntrySchema = Schema.mutable(
  Schema.Struct({
    id: Id,
    case: Schema.String,
    lawyer: Schema.String,
    activity: Schema.Literal(...TIME_ACTIVITIES),
    start: Schema.String,
    end: Schema.String,
    hours: Schema.Number,
    billable: Schema.Boolean,
  }),
);

const AppointmentSchema = Schema.mutable(
  Schema.Struct({
    id: Id,
    title: Schema.String,
    with: Schema.String,
    type: Schema.Literal(...APPOINTMENT_TYPES),
    date: Schema.String,
    time: Schema.String,
  }),
);

const DocumentSchema = Schema.mutable(
  Schema.Struct({
    id: Id,
    name: Schema.String,
    category: Schema.Literal(...DOCUMENT_CATEGORIES),
    case: Schema.String,
    version: Schema.Int,
    date: Schema.String,
    sigStatus: Schema.Literal(...SIGNATURE_STATUSES),
    versions: Schema.mutable(
      Schema.Array(
        Schema.mutable(
          Schema.Struct({
            n: Schema.Int,
            date: Schema.String,
            by: Schema.String,
          }),
        ),
      ),
    ),
    tags: Schema.mutable(Schema.Array(Schema.String)),
  }),
);

const InvoiceSchema = Schema.mutable(
  Schema.Struct({
    id: Id,
    number: Schema.String,
    client: Schema.String,
    case: Schema.String,
    amount: Schema.Number,
    method: Schema.Literal(...PAYMENT_METHODS),
    status: Schema.Literal(...INVOICE_STATUSES),
    lineItems: Schema.mutable(
      Schema.Array(
        Schema.mutable(
          Schema.Struct({
            desc: Schema.String,
            qty: Schema.Number,
            rate: Schema.Number,
            amount: Schema.Number,
          }),
        ),
      ),
    ),
  }),
);

const CommunicationSchema = Schema.mutable(
  Schema.Struct({
    id: Id,
    channel: Schema.Literal(...COMMUNICATION_CHANNELS),
    with: Schema.String,
    summary: Schema.String,
    date: Schema.String,
    icon: Schema.String,
  }),
);

const UserAccountSchema = Schema.mutable(
  Schema.Struct({
    name: Schema.String,
    role: RoleSchema,
    status: Schema.Literal(...ACCOUNT_STATUSES),
  }),
);

const PortalMessageSchema = Schema.mutable(
  Schema.Struct({
    from: Schema.String,
    date: Schema.String,
    text: Schema.String,
  }),
);

/**
 * Records the forms create, kept alongside the seed data rather than merged
 * into it: a screen reads `[...SEED, ...records.x]` and the seeded fixtures
 * stay untouched. Newest first, so a just-created record lands at the top of
 * the list that made it.
 *
 * **Cases are absent, and that absence is the shape of Phase 3.** Matters are
 * rows in Postgres now, so a second store of them in the browser would be a
 * second answer to what the firm has on its books — one the caseload screen
 * would not show and no invoice could be raised against. Every module still
 * listed here runs on the wireframe's arrays and keeps its entry until its own
 * migration takes it away the same way.
 */
export const CreatedRecords = Schema.mutable(
  Schema.Struct({
    clients: Schema.mutable(Schema.Array(ClientSchema)),
    hearings: Schema.mutable(Schema.Array(HearingSchema)),
    tasks: Schema.mutable(Schema.Array(TaskSchema)),
    timeEntries: Schema.mutable(Schema.Array(TimeEntrySchema)),
    appointments: Schema.mutable(Schema.Array(AppointmentSchema)),
    documents: Schema.mutable(Schema.Array(DocumentSchema)),
    invoices: Schema.mutable(Schema.Array(InvoiceSchema)),
    communications: Schema.mutable(Schema.Array(CommunicationSchema)),
    users: Schema.mutable(Schema.Array(UserAccountSchema)),
    messages: Schema.mutable(Schema.Array(PortalMessageSchema)),
  }),
);

export type CreatedRecords = typeof CreatedRecords.Type;

export const NO_RECORDS: CreatedRecords = {
  clients: [],
  hearings: [],
  tasks: [],
  timeEntries: [],
  appointments: [],
  documents: [],
  invoices: [],
  communications: [],
  users: [],
  messages: [],
};

// ── Firm settings ─────────────────────────────────────────────────────────

export const Settings = Schema.mutable(
  Schema.Struct({
    firmName: Schema.String,
    currency: Schema.Literal(...CURRENCIES),
    timezone: Schema.Literal(...TIMEZONES),
    dateFormat: Schema.Literal(...DATE_FORMATS),
    channels: Schema.mutable(Schema.Array(Schema.String)),
  }),
);

export const DEFAULT_SETTINGS: FirmSettings = {
  firmName: "OKLaw Advocates",
  currency: "KES",
  timezone: "Africa/Nairobi",
  dateFormat: "DD MMM YYYY",
  channels: ["In-app", "Email", "SMS"],
};

// ── Invoice overrides ─────────────────────────────────────────────────────

/**
 * Invoice id → status, layered over the seed data when a payment lands.
 *
 * Keyed by string, because JSON has no other kind of key. A
 * `Schema.NumberFromString` key would describe the type the screens *think*
 * they are indexing with, and is refused at construction — "Unsupported key
 * schema" — because a record key is not a place a transformation can run. The
 * ids are numbers and TypeScript indexes a string-keyed record with one
 * happily, which is the same coercion the browser does anyway.
 */
export const InvoiceOverrides = Schema.mutable(
  Schema.Record({
    key: Schema.String,
    value: Schema.Literal(...INVOICE_STATUSES),
  }),
);

export type InvoiceOverrides = typeof InvoiceOverrides.Type;

// ── The proof ─────────────────────────────────────────────────────────────

/**
 * Each schema decodes to exactly the interface the screens are written
 * against.
 *
 * Without this the store would be free to drift from `lib/types.ts` one field
 * at a time, and the first evidence would be a decode failure in a browser that
 * has been running the old version — which is the worst place to find out,
 * because the data is already written.
 */
export const RECORDS_MATCH_TYPES: {
  readonly role: Identical<typeof RoleSchema.Type, Role>;
  readonly client: Identical<typeof ClientSchema.Type, Client>;
  readonly hearing: Identical<typeof HearingSchema.Type, Hearing>;
  readonly task: Identical<typeof TaskSchema.Type, FirmTask>;
  readonly timeEntry: Identical<typeof TimeEntrySchema.Type, TimeEntry>;
  readonly appointment: Identical<typeof AppointmentSchema.Type, Appointment>;
  readonly document: Identical<typeof DocumentSchema.Type, FirmDocument>;
  readonly invoice: Identical<typeof InvoiceSchema.Type, Invoice>;
  readonly communication: Identical<
    typeof CommunicationSchema.Type,
    Communication
  >;
  readonly user: Identical<typeof UserAccountSchema.Type, UserAccount>;
  readonly message: Identical<typeof PortalMessageSchema.Type, PortalMessage>;
  readonly settings: Identical<typeof Settings.Type, FirmSettings>;
} = {
  role: true,
  client: true,
  hearing: true,
  task: true,
  timeEntry: true,
  appointment: true,
  document: true,
  invoice: true,
  communication: true,
  user: true,
  message: true,
  settings: true,
};
