/**
 * The entity-relationship diagram, read out of the schema rather than drawn.
 *
 * ## Why generated
 *
 * A hand-drawn ERD is accurate on the day it is committed. Eighteen migrations
 * later it is a picture of a database that no longer exists, and the failure is
 * silent — nothing typechecks a diagram. So this reads `information_schema`
 * after the real migrations have been applied, and `erd.test.ts` fails when the
 * committed `docs/erd.md` no longer matches what the migrations produce. The
 * diagram cannot go stale without a red test.
 *
 * ## What it deliberately leaves out
 *
 * Every `CHECK`, and both triggers. This file answers "what is stored and what
 * points at what", which is the question a diagram is good at. The interesting
 * half of this schema is the constraints — Rule 10 enforced by a trigger, a
 * magistrate rank permitted only in a magistrates' court, a cause number
 * refused without a filing date — and rendering thirty predicates into boxes
 * would make an unreadable picture out of something `0001_initial_schema.ts`
 * already states in SQL, with the reasoning beside it. The generated page links
 * there instead.
 *
 * The catalogue is read through a callback rather than a client, so nothing in
 * `src/` imports PGlite: the driver is a devDependency, and an import of it
 * from application code would be traced into the deployment bundle.
 */

/** Whatever can run a query and hand back rows — PGlite here, `pg` elsewhere. */
export type Query = <Row>(sql: string) => Promise<readonly Row[]>;

export interface Column {
  readonly name: string;
  readonly type: string;
  readonly nullable: boolean;
  readonly primary: boolean;
  readonly unique: boolean;
  readonly references: string | null;
}

export interface Table {
  readonly name: string;
  readonly columns: readonly Column[];
}

export interface Reference {
  readonly from: string;
  readonly to: string;
  readonly column: string;
  readonly optional: boolean;
}

export interface Catalog {
  readonly tables: readonly Table[];
  readonly references: readonly Reference[];
}

interface ColumnRow {
  readonly table_name: string;
  readonly column_name: string;
  readonly data_type: string;
  readonly udt_name: string;
  readonly is_nullable: string;
  readonly position: number;
}

interface KeyRow {
  readonly table_name: string;
  readonly column_name: string;
  readonly kind: string;
  readonly target: string | null;
}

/**
 * Postgres's own names for its types, shortened to the ones a reader uses.
 *
 * `character varying` and `timestamp with time zone` are correct and take half
 * the width of a box each. The enums keep their own names — `case_status` says
 * more than `USER-DEFINED` — which is why `udt_name` is read alongside
 * `data_type`.
 */
const readable = (dataType: string, udt: string): string => {
  if (dataType === "USER-DEFINED" || dataType === "ARRAY") return udt;

  return (
    {
      "character varying": "varchar",
      "timestamp with time zone": "timestamptz",
      "timestamp without time zone": "timestamp",
      "double precision": "float8",
    }[dataType] ?? dataType
  );
};

/**
 * Mermaid's attribute grammar takes a bare word for a type, so anything with a
 * space in it is not renderable. Nothing in this schema has one after
 * `readable`, but a future `numeric(12, 2)` would, and it would break the whole
 * diagram rather than one row.
 */
const word = (type: string): string => type.replace(/[^A-Za-z0-9_]/g, "_");

export const readCatalog = async (query: Query): Promise<Catalog> => {
  const columns = await query<ColumnRow>(`
    SELECT c.table_name, c.column_name, c.data_type, c.udt_name,
           c.is_nullable, c.ordinal_position AS position
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
     ORDER BY c.table_name, c.ordinal_position
  `);

  /**
   * Primary keys, single-column unique constraints, and foreign keys in one
   * query. Composite keys are read out column by column, which is right for
   * marking them and wrong for describing them — noted on the page rather than
   * silently flattened.
   */
  const keys = await query<KeyRow>(`
    SELECT tc.table_name,
           kcu.column_name,
           tc.constraint_type AS kind,
           ccu.table_name AS target
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
       AND kcu.table_schema = tc.table_schema
      LEFT JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
       AND ccu.table_schema = tc.table_schema
       AND tc.constraint_type = 'FOREIGN KEY'
     WHERE tc.table_schema = 'public'
       AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE', 'FOREIGN KEY')
  `);

  const marked = (table: string, column: string, kind: string): boolean =>
    keys.some(
      (key) =>
        key.table_name === table &&
        key.column_name === column &&
        key.kind === kind,
    );

  const target = (table: string, column: string): string | null =>
    keys.find(
      (key) =>
        key.table_name === table &&
        key.column_name === column &&
        key.kind === "FOREIGN KEY",
    )?.target ?? null;

  const names = [...new Set(columns.map((row) => row.table_name))].sort();

  const tables = names.map((name) => ({
    name,
    columns: columns
      .filter((row) => row.table_name === name)
      .map((row) => ({
        name: row.column_name,
        type: readable(row.data_type, row.udt_name),
        nullable: row.is_nullable === "YES",
        primary: marked(name, row.column_name, "PRIMARY KEY"),
        unique: marked(name, row.column_name, "UNIQUE"),
        references: target(name, row.column_name),
      })),
  }));

  const references = tables
    .flatMap((table) =>
      table.columns
        .filter((column) => column.references !== null)
        .map((column) => ({
          from: table.name,
          to: column.references ?? "",
          column: column.name,
          optional: column.nullable,
        })),
    )
    .sort((a, b) =>
      `${a.to}${a.from}${a.column}`.localeCompare(
        `${b.to}${b.from}${b.column}`,
      ),
    );

  return { tables, references };
};

/**
 * `||--o{` where the child's key may be null and `||--|{` where it may not, so
 * the picture distinguishes "a matter *may* name a court" from "a hearing
 * *belongs to* a matter". That distinction is the entire reason a nullable
 * foreign key is a design decision rather than a detail — a matter filed at the
 * Tax Appeals Tribunal has no court in the Article 162 hierarchy to point at.
 */
const cardinality = (reference: Reference): string =>
  reference.optional ? "||--o{" : "||--|{";

const attribute = (column: Column): string => {
  const keys = [
    column.primary ? "PK" : "",
    column.references !== null ? "FK" : "",
    column.unique && !column.primary ? "UK" : "",
  ]
    .filter(Boolean)
    .join(",");

  return `    ${word(column.type)} ${column.name}${keys === "" ? "" : ` ${keys}`}`;
};

/**
 * The whole page, prose included, because the prose is what makes the picture
 * legible — and because a generated file with a hand-written preamble beside it
 * is two files that drift.
 *
 * The tables are grouped by what they are *for* rather than left in the
 * alphabetical order the catalogue returns: a reader arriving at eighteen boxes
 * needs to know which four are the firm's work and which four are the login,
 * and no query can answer that. The grouping is the one hand-written thing
 * here, and `erd.test.ts` fails if a table appears that no group claims.
 */
export const GROUPS: readonly {
  readonly title: string;
  readonly note: string;
  readonly tables: readonly string[];
}[] = [
  {
    title: "The firm's work",
    note: "A matter is the centre of the schema: everything below except the ledger and the login hangs off `cases`.",
    tables: ["cases", "hearings", "time_entries", "tasks", "appointments"],
  },
  {
    title: "Who the firm acts for, and who acts",
    note: "`clients` is a tagged union flattened into a `kind` column, with a `CHECK` per branch — a corporate client must have a KRA PIN with the corporate prefix, and must name somebody who can instruct.",
    tables: [
      "clients",
      "client_contacts",
      "advocates",
      "contacts",
      "messages",
      "precedents",
    ],
  },
  {
    title: "Money",
    note: "Every amount is `bigint` minor units. An invoice stores neither its total nor its status: both are derived from the lines and the payments, in the domain, which is why `invoice_lines` and `payments` carry an ordering column and `invoices` carries no `amount`.",
    tables: ["invoices", "invoice_lines", "payments", "trust_movements"],
  },
  {
    title: "Documents",
    note: "The bytes are in Vercel Blob; these rows hold the register and the version history, which is append-only — a filed document cannot be revised.",
    tables: ["documents", "document_versions"],
  },
  {
    title: "Identity and the trail",
    note: "`users`, `sessions` and `accounts` are Better Auth's tables, written by our migrations rather than its CLI so that the staff/client link is ours (ADR 0004). `audit_log` refuses `UPDATE` and `DELETE` outright, and `auth_attempts` stores a hash of the bucket rather than the address that spent it.",
    tables: [
      "users",
      "sessions",
      "accounts",
      "verifications",
      "audit_log",
      "auth_attempts",
    ],
  },
];

export const renderPage = (catalog: Catalog): string => {
  const grouped = GROUPS.map((group) => {
    const rows = group.tables.map((name) => {
      const table = catalog.tables.find((candidate) => candidate.name === name);
      const columns = table?.columns.length ?? 0;
      return `| \`${name}\` | ${columns} |`;
    });

    return [
      `### ${group.title}`,
      "",
      group.note,
      "",
      "| Table | Columns |",
      "| ----- | ------- |",
      ...rows,
      "",
    ].join("\n");
  });

  return [
    "# The database, as it actually is",
    "",
    "<!-- Generated by `npm run docs:erd`. Do not edit by hand:",
    "     `src/infra/sql/erd.test.ts` fails when this file and the migrations",
    "     disagree, and it compares the whole page. -->",
    "",
    `${catalog.tables.length} tables and ${catalog.references.length} foreign` +
      " keys, read out of `information_schema` after every migration has been",
    "applied to a real Postgres — PGlite, in-process, the same way",
    "`schema.test.ts` checks the constraints. Nothing here is drawn from memory.",
    "",
    "**What is not on it.** Every `CHECK`, both triggers, and every partial",
    "index. This page answers *what is stored and what points at what*; the",
    "interesting half of this schema is the rules — Rule 10 enforced by a",
    "trigger with `SELECT … FOR UPDATE`, a magistrate rank permitted only in a",
    "magistrates' court, a cause number refused without a filing date — and",
    "they are in [`0001_initial_schema.ts`](../src/infra/sql/migrations/0001_initial_schema.ts)",
    "with the reasoning beside each one.",
    "",
    "`||--|{` is a foreign key that cannot be null and `||--o{` one that can.",
    "The difference carries meaning here: a hearing *belongs to* a matter, and a",
    "matter only *may* name a court, because the Tax Appeals Tribunal is",
    "constituted under its own Act and is not in the Article 162 hierarchy.",
    "",
    "```mermaid",
    renderErd(catalog),
    "```",
    "",
    "## What each group of tables is for",
    "",
    ...grouped,
    "",
  ].join("\n");
};

export const renderErd = (catalog: Catalog): string => {
  const entities = catalog.tables.map((table) =>
    [`  ${table.name} {`, ...table.columns.map(attribute), "  }"].join("\n"),
  );

  const edges = catalog.references.map(
    (reference) =>
      `  ${reference.to} ${cardinality(reference)} ${reference.from} : ${reference.column}`,
  );

  return ["erDiagram", ...entities, ...edges].join("\n");
};
