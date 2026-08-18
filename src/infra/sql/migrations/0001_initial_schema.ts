import { SqlClient } from "@effect/sql";
import { Effect } from "effect";

/**
 * The initial schema.
 *
 * The organising principle: **every invariant the domain enforces is also a
 * constraint here, wherever the database can express it.** Application code is
 * one way in. Migrations, imports, a psql session at two in the morning, and a
 * future service written by someone who has not read `src/domain/` are all
 * other ways in, and a `CHECK` holds for every one of them.
 *
 * Money is `bigint` cents throughout — never `numeric`, never `float`. It
 * mirrors `Money` in the domain, which is an integer count of cents for the
 * same reason.
 */
export const statements: readonly string[] = [
  // ── Enumerations ────────────────────────────────────────────────────────
  //
  // Postgres enums rather than free text, so a status the application has never
  // heard of cannot be written. They are awkward to alter, which is a real cost
  // — but a `status` column holding "Actve" is a worse one.

  `
    CREATE TYPE case_status AS ENUM (
      'New', 'Active', 'Hearing Scheduled', 'Under Review',
      'Judgment Pending', 'Closed', 'Appealed'
    );

    CREATE TYPE matter_type AS ENUM (
      'Civil', 'Criminal', 'Family', 'Probate', 'Labour',
      'Land', 'Commercial', 'Tax', 'Constitutional', 'Arbitration'
    );

    CREATE TYPE magistrate_rank AS ENUM (
      'Chief Magistrate', 'Senior Principal Magistrate', 'Principal Magistrate',
      'Senior Resident Magistrate', 'Resident Magistrate'
    );

    CREATE TYPE court_kind AS ENUM (
      'SupremeCourt', 'CourtOfAppeal', 'HighCourt',
      'EmploymentAndLabourRelationsCourt', 'EnvironmentAndLandCourt',
      'MagistratesCourt'
    );

    CREATE TYPE client_kind AS ENUM ('Individual', 'Corporate');

    CREATE TYPE staff_role AS ENUM (
      'System Administrator', 'Managing Partner', 'Advocate',
      'Legal Assistant', 'Finance Officer', 'Receptionist'
    );

    CREATE TYPE trust_reason AS ENUM (
      'Deposit received', 'Payment to client', 'Payment on behalf of client',
      'Transfer to office account for costs', 'Reimbursement of disbursement',
      'Refund of unused balance'
    );

    CREATE TYPE payment_method AS ENUM (
      'M-Pesa', 'Bank Transfer', 'Cheque', 'Cash', 'Card'
    );

    CREATE TYPE hearing_kind AS ENUM (
      'Mention', 'Hearing', 'Ruling', 'Judgment', 'Directions', 'Application'
    );

    CREATE TYPE hearing_outcome AS ENUM (
      'Heard', 'Adjourned', 'NotReached', 'Withdrawn'
    );

    CREATE TYPE signature_status AS ENUM (
      'Not required', 'Awaiting signature', 'Signed'
    );

    CREATE TYPE document_category AS ENUM (
      'Pleadings', 'Contracts', 'Witness Statements', 'Affidavits',
      'Judgments', 'Correspondence', 'Attendance Notes'
    );

    CREATE TYPE activity AS ENUM (
      'Research', 'Drafting', 'Court attendance', 'Consultation',
      'Correspondence', 'Travel', 'Administration'
    );
  `,

  // ── People ──────────────────────────────────────────────────────────────

  `
    CREATE TABLE advocates (
      id                  uuid PRIMARY KEY,
      name                text NOT NULL CHECK (btrim(name) <> ''),
      role                staff_role NOT NULL,
      email               text NOT NULL CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
      certificate_number  text,
      certificate_year    integer CHECK (certificate_year BETWEEN 2000 AND 2100),
      admitted_on         date,
      active              boolean NOT NULL DEFAULT true,
      created_at          timestamptz NOT NULL DEFAULT now(),

      -- A certificate is a number and a year together, or neither. Half a
      -- certificate cannot be reasoned about.
      CONSTRAINT certificate_complete CHECK (
        (certificate_number IS NULL) = (certificate_year IS NULL)
      )
    );

    CREATE TABLE clients (
      id                  uuid PRIMARY KEY,
      number              text NOT NULL UNIQUE CHECK (number ~ '^CLT-[0-9]{4}$'),
      kind                client_kind NOT NULL,
      name                text NOT NULL CHECK (btrim(name) <> ''),
      email               text NOT NULL CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
      phone               text NOT NULL CHECK (phone ~ '^\\+254[17][0-9]{8}$'),
      kra_pin             text CHECK (kra_pin ~ '^[AP][0-9]{9}[A-Z]$'),
      registration_number text,
      onboarded_on        date NOT NULL,
      created_at          timestamptz NOT NULL DEFAULT now(),

      -- KRA issues A pins to individuals and P pins to entities. A mismatch
      -- means one of the two fields is wrong; catching it here means it cannot
      -- be introduced by an import that skips the domain check.
      CONSTRAINT pin_matches_kind CHECK (
        kra_pin IS NULL
        OR (kind = 'Individual' AND kra_pin LIKE 'A%')
        OR (kind = 'Corporate'  AND kra_pin LIKE 'P%')
      ),

      -- Only companies have registration numbers.
      CONSTRAINT registration_only_for_corporate CHECK (
        registration_number IS NULL OR kind = 'Corporate'
      )
    );

    CREATE TABLE client_contacts (
      id         uuid PRIMARY KEY,
      client_id  uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      name       text NOT NULL CHECK (btrim(name) <> ''),
      role       text NOT NULL CHECK (btrim(role) <> ''),
      email      text CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
      phone      text CHECK (phone ~ '^\\+254[17][0-9]{8}$')
    );

    CREATE INDEX client_contacts_by_client ON client_contacts (client_id);
  `,

  // ── Matters ─────────────────────────────────────────────────────────────

  `
    CREATE TABLE cases (
      id                  uuid PRIMARY KEY,
      number              text NOT NULL UNIQUE CHECK (number ~ '^OKL-[0-9]{4}-[0-9]{3}$'),
      cause_number        text,
      title               text NOT NULL CHECK (btrim(title) <> ''),
      type                matter_type NOT NULL,
      status              case_status NOT NULL,
      client_id           uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
      advocate_id         uuid NOT NULL REFERENCES advocates(id) ON DELETE RESTRICT,

      court_kind          court_kind,
      court_station       text,
      court_division      text,
      court_rank          magistrate_rank,

      claim_value_cents   bigint CHECK (claim_value_cents >= 0),
      under_customary_law boolean NOT NULL DEFAULT false,
      accrued_on          date,
      limitation_basis    text CHECK (
        limitation_basis IN ('contract', 'tort', 'defamation', 'personal injury')
      ),
      opened_on           date NOT NULL,
      filed_on            date NOT NULL DEFAULT '1970-01-01',
      created_at          timestamptz NOT NULL DEFAULT now(),

      -- A magistrates' court is the only kind with a rank, and it must have one.
      -- Without this, a row can claim the Supreme Court is presided over by a
      -- Resident Magistrate, and the pecuniary check downstream reads it.
      CONSTRAINT rank_iff_magistrates_court CHECK (
        (court_rank IS NOT NULL) = (court_kind = 'MagistratesCourt')
      ),

      -- A court needs a station, except the Supreme Court, of which there is one.
      CONSTRAINT station_present CHECK (
        court_kind IS NULL
        OR court_kind = 'SupremeCourt'
        OR btrim(coalesce(court_station, '')) <> ''
      ),

      -- Only the High Court sits in divisions.
      CONSTRAINT division_only_for_high_court CHECK (
        court_division IS NULL OR court_kind = 'HighCourt'
      ),

      -- A cause number is assigned on filing, so one without a filing date is
      -- a record of something that did not happen.
      CONSTRAINT cause_number_needs_filing CHECK (
        cause_number IS NULL OR filed_on <> '1970-01-01'
      ),

      -- The limitation clock needs both halves or neither; one alone computes
      -- nothing, and storing it invites a later guess at the other.
      CONSTRAINT limitation_complete CHECK (
        (accrued_on IS NULL) = (limitation_basis IS NULL)
      ),

      CONSTRAINT filed_after_opened CHECK (
        filed_on = '1970-01-01' OR filed_on >= opened_on
      )
    );

    CREATE INDEX cases_by_client   ON cases (client_id);
    CREATE INDEX cases_by_advocate ON cases (advocate_id);
    CREATE INDEX cases_by_status   ON cases (status) WHERE status <> 'Closed';
  `,

  `
    CREATE TABLE hearings (
      id             uuid PRIMARY KEY,
      case_id        uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      kind           hearing_kind NOT NULL,
      court_kind     court_kind NOT NULL,
      court_station  text,
      court_division text,
      court_rank     magistrate_rank,
      room           text,
      scheduled_for  timestamptz NOT NULL,
      advocate_id    uuid NOT NULL REFERENCES advocates(id) ON DELETE RESTRICT,

      outcome        hearing_outcome,
      outcome_note   text,
      adjourned_to   timestamptz,
      adjourned_reason text,

      CONSTRAINT rank_iff_magistrates_court CHECK (
        (court_rank IS NOT NULL) = (court_kind = 'MagistratesCourt')
      ),

      -- An adjournment must say where the matter went, and a date it went to
      -- only makes sense for an adjournment. This is the constraint that stops
      -- matters falling off the diary.
      CONSTRAINT adjournment_has_destination CHECK (
        (outcome = 'Adjourned') = (adjourned_to IS NOT NULL)
      ),

      CONSTRAINT adjournment_moves_forward CHECK (
        adjourned_to IS NULL OR adjourned_to > scheduled_for
      )
    );

    CREATE INDEX hearings_by_case ON hearings (case_id);
    CREATE INDEX hearings_upcoming ON hearings (scheduled_for) WHERE outcome IS NULL;
  `,

  // ── Documents ───────────────────────────────────────────────────────────

  `
    CREATE TABLE documents (
      id               uuid PRIMARY KEY,
      case_id          uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      name             text NOT NULL CHECK (btrim(name) <> ''),
      category         document_category NOT NULL,
      signature_status signature_status NOT NULL DEFAULT 'Not required',
      filed_with_court boolean NOT NULL DEFAULT false,
      created_at       timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE document_versions (
      document_id  uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      number       integer NOT NULL CHECK (number > 0),
      storage_key  text NOT NULL CHECK (btrim(storage_key) <> ''),
      size_bytes   bigint NOT NULL CHECK (size_bytes > 0),
      uploaded_by  uuid NOT NULL REFERENCES advocates(id) ON DELETE RESTRICT,
      uploaded_on  timestamptz NOT NULL DEFAULT now(),

      PRIMARY KEY (document_id, number)
    );

    CREATE INDEX documents_by_case ON documents (case_id);
  `,

  // ── Time and billing ────────────────────────────────────────────────────

  `
    CREATE TABLE time_entries (
      id                uuid PRIMARY KEY,
      case_id           uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      advocate_id       uuid NOT NULL REFERENCES advocates(id) ON DELETE RESTRICT,
      activity          activity NOT NULL,
      minutes           integer NOT NULL CHECK (minutes > 0),
      worked_on         date NOT NULL,
      billable          boolean NOT NULL,
      hourly_rate_cents bigint NOT NULL CHECK (hourly_rate_cents >= 0),
      narrative         text NOT NULL CHECK (btrim(narrative) <> ''),
      invoice_id        uuid,
      created_at        timestamptz NOT NULL DEFAULT now(),

      -- Non-billable work cannot be carried onto a fee note.
      CONSTRAINT only_billable_time_is_invoiced CHECK (
        invoice_id IS NULL OR billable
      )
    );

    CREATE INDEX time_entries_by_case ON time_entries (case_id);
    CREATE INDEX time_entries_unbilled
      ON time_entries (case_id) WHERE billable AND invoice_id IS NULL;

    CREATE TABLE invoices (
      id         uuid PRIMARY KEY,
      number     text NOT NULL UNIQUE CHECK (number ~ '^INV-[0-9]{4}$'),
      client_id  uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
      case_id    uuid REFERENCES cases(id) ON DELETE SET NULL,
      issued_on  date NOT NULL,
      due_on     date NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),

      CONSTRAINT due_after_issue CHECK (due_on >= issued_on)
    );

    -- Note what is absent: there is no total column. The total is the sum of
    -- the lines, and a stored copy is a second source of truth that eventually
    -- disagrees with the first. Same reasoning as the domain's Invoice.total.

    CREATE TABLE invoice_lines (
      id                   uuid PRIMARY KEY,
      invoice_id           uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      description          text NOT NULL CHECK (btrim(description) <> ''),
      quantity_hundredths  integer NOT NULL CHECK (quantity_hundredths > 0),
      unit_price_cents     bigint NOT NULL CHECK (unit_price_cents >= 0)
    );

    CREATE INDEX invoice_lines_by_invoice ON invoice_lines (invoice_id);

    CREATE TABLE payments (
      id           uuid PRIMARY KEY,
      invoice_id   uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      amount_cents bigint NOT NULL CHECK (amount_cents > 0),
      method       payment_method NOT NULL,
      received_on  date NOT NULL,
      reference    text
    );

    CREATE INDEX payments_by_invoice ON payments (invoice_id);

    ALTER TABLE time_entries
      ADD CONSTRAINT time_entries_invoice_fk
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL;
  `,

  // ── Client trust money ──────────────────────────────────────────────────

  `
    CREATE TABLE trust_movements (
      id           uuid PRIMARY KEY,
      client_id    uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
      reason       trust_reason NOT NULL,
      amount_cents bigint NOT NULL CHECK (amount_cents > 0),
      recorded_at  timestamptz NOT NULL DEFAULT now(),
      reference    text,
      case_id      uuid REFERENCES cases(id) ON DELETE SET NULL
    );

    CREATE INDEX trust_movements_by_client ON trust_movements (client_id);
  `,

  // Amounts are unsigned and direction comes from the reason, exactly as in the
  // domain — a "deposit" of minus five thousand is not representable.
  `
    CREATE FUNCTION trust_signed_amount(reason trust_reason, amount bigint)
    RETURNS bigint
    LANGUAGE sql IMMUTABLE
    AS $$
      SELECT CASE WHEN reason = 'Deposit received' THEN amount ELSE -amount END;
    $$;

    -- The cast is deliberate: sum(bigint) returns numeric in Postgres, which
    -- arrives in the driver as a string and would make this the one money
    -- column in the schema that reads differently from all the others.
    CREATE VIEW client_trust_balances AS
      SELECT client_id,
             sum(trust_signed_amount(reason, amount_cents))::bigint AS balance_cents
      FROM trust_movements
      GROUP BY client_id;
  `,

  /**
   * Rule 10 of the Advocates (Accounts) Rules, enforced by the database.
   *
   * A `CHECK` cannot express this: it needs the sum of every other row for the
   * same client, and `CHECK` sees one row. A trigger can, and this is the case
   * that justifies one — the rule is a legal obligation about client money, and
   * the cost of it being wrong is not a bug report.
   *
   * The `FOR UPDATE` lock matters. Two concurrent withdrawals that each read a
   * balance of 200,000 would both pass a naive check and together overdraw the
   * client. Locking the client row serialises them, so the second sees the
   * first's effect.
   */
  `
    CREATE FUNCTION enforce_trust_rule_10()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      held bigint;
    BEGIN
      IF NEW.reason = 'Deposit received' THEN
        RETURN NEW;
      END IF;

      PERFORM 1 FROM clients WHERE id = NEW.client_id FOR UPDATE;

      SELECT coalesce(sum(trust_signed_amount(reason, amount_cents)), 0)
        INTO held
        FROM trust_movements
       WHERE client_id = NEW.client_id;

      IF NEW.amount_cents > held THEN
        RAISE EXCEPTION
          'Advocates (Accounts) Rules r.10: cannot withdraw % cents against a balance of % cents for client %',
          NEW.amount_cents, held, NEW.client_id
          USING ERRCODE = 'check_violation';
      END IF;

      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER trust_movements_rule_10
      BEFORE INSERT ON trust_movements
      FOR EACH ROW EXECUTE FUNCTION enforce_trust_rule_10();
  `,
];

/**
 * The migration itself: run each statement in order.
 *
 * The statements are exported separately so the schema test can apply exactly
 * the same DDL to a throwaway Postgres. A test that builds its own tables
 * proves only that the test's idea of the schema is self-consistent.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const statement of statements) {
    yield* sql.unsafe(statement);
  }
});
