import { SqlClient } from "@effect/sql";
import { Effect } from "effect";

/**
 * Logins, sessions, and the audit trail.
 *
 * ## Why these tables are written here rather than generated
 *
 * Better Auth ships a CLI that generates its own migration. Using it would put
 * the four tables it owns outside this sequence — applied by a different tool,
 * in a different order, with no record in `effect_sql_migrations` — and the
 * first consequence is that a fresh database is no longer reproducible from one
 * command. The second is worse: `users` is not only Better Auth's table. It is
 * where a login is tied to a member of staff or to a client, and that link
 * carries the constraint the whole of Phase 6 rests on.
 *
 * So the tables are declared here, in the shape Better Auth expects, and the
 * expectation is *verified* rather than assumed: `auth-schema.test.ts` asks
 * Better Auth itself, through `getSchema`, which tables and columns it requires
 * and compares them against the DDL below. A field added by a future version
 * fails that test rather than failing a query at two in the morning.
 *
 * ## snake_case
 *
 * Better Auth's field names are camelCase and, left alone, become quoted
 * `"emailVerified"` columns — which then need quoting forever, in every hand
 * written query, next to eleven tables that do not. `infra/auth/options.ts`
 * maps every field to snake_case explicitly, and those names are what appear
 * here.
 */

export const statements: readonly string[] = [
  // ── Logins ──────────────────────────────────────────────────────────────
  //
  // A login is not a person. `advocates` is who works at the firm and `clients`
  // is who instructs it; both exist and matter for people who have never signed
  // in. This table is the credential, and it points at one of the two.

  `
    CREATE TABLE users (
      id             uuid PRIMARY KEY,
      name           text NOT NULL CHECK (btrim(name) <> ''),
      email          text NOT NULL UNIQUE CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
      email_verified boolean NOT NULL DEFAULT false,
      image          text,
      advocate_id    uuid REFERENCES advocates (id) ON DELETE RESTRICT,
      client_id      uuid REFERENCES clients (id) ON DELETE RESTRICT,
      disabled_at    timestamptz,
      created_at     timestamptz NOT NULL DEFAULT now(),
      updated_at     timestamptz NOT NULL DEFAULT now(),

      -- The constraint that makes the domain's Principal union real.
      --
      -- A row with both links is a member of staff who is also a client of the
      -- firm as far as the authorization code is concerned, and the code would
      -- have to choose which link to believe. A row with neither is a login
      -- that authenticates to nothing. Neither is representable in
      -- domain/identity/principal.ts, and neither is representable here, so
      -- the two cannot disagree — including for a row written by a migration,
      -- an import, or a psql session.
      CONSTRAINT users_exactly_one_subject CHECK (
        (advocate_id IS NULL) <> (client_id IS NULL)
      )
    );

    -- One login per member of staff and per client. Two logins onto the same
    -- client would both be "the client" in the audit trail, and there would be
    -- no way to tell afterwards which person acted.
    CREATE UNIQUE INDEX users_advocate ON users (advocate_id) WHERE advocate_id IS NOT NULL;
    CREATE UNIQUE INDEX users_client ON users (client_id) WHERE client_id IS NOT NULL;
  `,

  // ── Sessions ────────────────────────────────────────────────────────────

  `
    CREATE TABLE sessions (
      id          uuid PRIMARY KEY,
      user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      token       text NOT NULL UNIQUE,
      expires_at  timestamptz NOT NULL,
      ip_address  text,
      user_agent  text,
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now()
    );

    -- ON DELETE CASCADE above is the important half of signing everyone out:
    -- deleting the login takes its sessions with it, so a disabled account
    -- cannot keep working until its cookie happens to expire.
    CREATE INDEX sessions_by_user ON sessions (user_id);
    CREATE INDEX sessions_expiry ON sessions (expires_at);
  `,

  // ── Credentials ─────────────────────────────────────────────────────────
  //
  // `password` holds a scrypt hash, produced by Better Auth and never read by
  // anything in src/domain or src/services. That is the whole reason the
  // library is here (ADR 0004): the one part of this system where writing it
  // ourselves would be a demonstration of poor judgement rather than of skill.

  `
    CREATE TABLE accounts (
      id                       uuid PRIMARY KEY,
      user_id                  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      account_id               text NOT NULL,
      provider_id              text NOT NULL,
      issuer                   text NOT NULL,
      password                 text,
      access_token             text,
      refresh_token            text,
      id_token                 text,
      access_token_expires_at  timestamptz,
      refresh_token_expires_at timestamptz,
      scope                    text,
      created_at               timestamptz NOT NULL DEFAULT now(),
      updated_at               timestamptz NOT NULL DEFAULT now(),

      -- One credential per issuer per person. Two 'credential' rows for one
      -- user means two passwords that both work, and only one of them was
      -- ever changed by whoever thought they had changed it.
      --
      -- On (issuer, account_id) rather than (provider_id, account_id) because
      -- that is the index Better Auth declares, and updatePassword looks a row
      -- up by exactly those two columns. issuer is 'local:credential' for a
      -- password and the provider's own issuer for OAuth, which is what keeps
      -- a provider named "credential" from colliding with the real one.
      CONSTRAINT accounts_issuer_unique UNIQUE (issuer, account_id)
    );

    CREATE INDEX accounts_by_user ON accounts (user_id);
  `,

  // ── Verification tokens ─────────────────────────────────────────────────
  //
  // Single-use tokens: password resets today, email verification when there is
  // an email provider to send it with.

  `
    CREATE TABLE verifications (
      id         uuid PRIMARY KEY,
      identifier text NOT NULL,
      value      text NOT NULL,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX verifications_identifier ON verifications (identifier);
  `,

  // ── The audit trail ─────────────────────────────────────────────────────

  `
    CREATE TYPE audit_action AS ENUM (
      'case.opened', 'case.amended', 'case.transitioned',
      'session.signed-in', 'session.signed-out', 'session.refused'
    );

    CREATE TYPE audited_entity AS ENUM ('case', 'client', 'invoice', 'user');

    CREATE TABLE audit_log (
      id          uuid PRIMARY KEY,
      at          timestamptz NOT NULL DEFAULT now(),

      -- The actor, copied rather than joined. Staff leave, names change and
      -- roles are reassigned; an entry is a statement about the past and must
      -- keep saying what was true when it was written. actor_user_id is a
      -- plain uuid and deliberately not a foreign key for the same reason —
      -- and because a refused sign-in has no user behind it at all.
      actor_user_id uuid,
      actor_name    text NOT NULL,
      actor_role    text NOT NULL,

      action      audit_action NOT NULL,
      entity      audited_entity NOT NULL,
      entity_id   text,

      -- Snapshots, as the entity encoded at the time. jsonb rather than json:
      -- it is queryable, and Phase 8's "what changed on this matter" report
      -- wants an index on it eventually.
      before      jsonb,
      after       jsonb,

      -- An entry that records neither a subject nor a change records nothing.
      -- The session events are the exception: they act on no row.
      CONSTRAINT audit_subject CHECK (
        entity_id IS NOT NULL OR action::text LIKE 'session.%'
      )
    );

    CREATE INDEX audit_recent ON audit_log (at DESC);
    CREATE INDEX audit_by_entity ON audit_log (entity, entity_id);
    CREATE INDEX audit_by_actor ON audit_log (actor_user_id) WHERE actor_user_id IS NOT NULL;
  `,

  // ── Append-only ─────────────────────────────────────────────────────────
  //
  // An audit trail the application can edit is a record of what somebody was
  // willing to leave behind. Postgres can refuse the update outright, and the
  // refusal then holds for every route in — including the psql session.
  //
  // This does not defend against an attacker holding the database owner's
  // credentials, who can drop the trigger. It defends against the far more
  // likely thing: an ORM cascade, a well-meant cleanup script, or a future
  // service "correcting" an entry.

  `
    CREATE FUNCTION audit_log_is_append_only() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'audit_log is append-only: % refused', TG_OP;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER audit_log_no_update
      BEFORE UPDATE OR DELETE ON audit_log
      FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();
  `,
];

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const statement of statements) {
    yield* sql.unsafe(statement);
  }
});
