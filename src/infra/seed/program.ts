import { SqlClient } from "@effect/sql";
import { Effect, Either, Layer } from "effect";
import * as Money from "../../domain/shared/money";
import {
  AdvocateRepository,
  CaseRepository,
  ClientRepository,
  InvoiceRepository,
  TrustRepository,
} from "../../services/repositories";
import { AdvocateRepositoryLive } from "../sql/advocate-repository";
import { CaseRepositoryLive } from "../sql/case-repository";
import { PgLive } from "../sql/client";
import { ClientRepositoryLive } from "../sql/client-repository";
import { InvoiceRepositoryLive } from "../sql/invoice-repository";
import { TrustRepositoryLive } from "../sql/trust-repository";
import {
  advocates,
  clientIdsByPrototypeKey,
  clients,
  invoices,
  matters,
  type SeedProblem,
  trustMovements,
} from "./prototype";

/**
 * Loads the demo dataset. Run with `npm run db:seed`.
 *
 * Two properties this script is built around.
 *
 * **It refuses rather than degrades.** Every fixture is decoded through its
 * domain schema before anything is written, and every failure is collected
 * before any of them is reported. A seed that silently drops the three records
 * it could not parse produces a demo that looks fine and a database that is
 * quietly missing rows — which is worse than a script that will not run.
 *
 * **It is idempotent.** Ids are derived from the prototype's keys rather than
 * generated, so a second run updates the same rows through the repositories'
 * upserts instead of inserting a parallel copy of the firm.
 *
 * The last step is the one that matters legally: `overdrawn` asks Postgres
 * whether any client's trust balance went negative. A seeded ledger that
 * breaches Rule 10 stops the import, because a demo that ships with a rule
 * violation baked in is a demo that teaches the wrong thing.
 */

const report = (stage: string, problems: readonly SeedProblem[]) =>
  Effect.fail(
    new Error(
      [
        `${problems.length} ${stage} fixture(s) cannot be decoded into the domain:`,
        ...problems.map((problem) => `  • ${problem.reason}`),
      ].join("\n"),
    ),
  );

/** Unwraps an adapter's result, turning accumulated problems into a failure. */
const adapted = <A>(
  stage: string,
  outcome: Either.Either<readonly A[], readonly SeedProblem[]>,
) =>
  Either.match(outcome, {
    onLeft: (problems) => report(stage, problems),
    onRight: (values) => Effect.succeed(values),
  });

/**
 * Clears the tables this script owns, children first.
 *
 * A wipe-and-load rather than a merge: this is a demonstration dataset with a
 * nightly reset (D-5), and a merge would accumulate whatever a previous version
 * of the fixtures happened to write. `trust_movements` goes first because the
 * ledger is append-only everywhere else in the system.
 */
const wipe = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`DELETE FROM trust_movements`;
  yield* sql`DELETE FROM payments`;
  yield* sql`DELETE FROM invoice_lines`;
  yield* sql`DELETE FROM invoices`;
  yield* sql`DELETE FROM cases`;
  yield* sql`DELETE FROM client_contacts`;
  yield* sql`DELETE FROM clients`;
  yield* sql`DELETE FROM advocates`;
});

export const seed = Effect.gen(function* () {
  const advocateRepo = yield* AdvocateRepository;
  const clientRepo = yield* ClientRepository;
  const caseRepo = yield* CaseRepository;
  const invoiceRepo = yield* InvoiceRepository;
  const trustRepo = yield* TrustRepository;

  // ── Decode everything before writing anything ──────────────────────────
  //
  // Ordered by dependency, because a matter needs the id of the client and the
  // advocate it belongs to, and those ids are derived from the prototype's own
  // keys rather than from the database.

  const staff = yield* adapted("staff", advocates());
  const advocateIds = new Map(staff.map((person) => [person.name, person.id]));

  const firmClients = yield* adapted("client", clients());
  const clientIdsByName = new Map(
    firmClients.map((client) => [client.name, client.id]),
  );

  const firmMatters = yield* adapted(
    "matter",
    matters(clientIdsByPrototypeKey(), advocateIds),
  );
  const caseIdsByNumber = new Map(
    firmMatters.map((matter) => [matter.number, matter.id]),
  );

  const firmInvoices = yield* adapted(
    "invoice",
    invoices(clientIdsByName, caseIdsByNumber),
  );
  const movements = yield* adapted("trust", trustMovements(clientIdsByName));

  // ── Write ──────────────────────────────────────────────────────────────

  yield* Effect.logInfo("Clearing the existing dataset…");
  yield* wipe;

  yield* Effect.logInfo(`Writing ${staff.length} staff…`);
  yield* Effect.forEach(staff, (person) => advocateRepo.save(person));

  yield* Effect.logInfo(`Writing ${firmClients.length} clients…`);
  yield* Effect.forEach(firmClients, (client) => clientRepo.save(client));

  yield* Effect.logInfo(`Writing ${firmMatters.length} matters…`);
  yield* Effect.forEach(firmMatters, (matter) => caseRepo.save(matter));

  yield* Effect.logInfo(`Writing ${firmInvoices.length} invoices…`);
  yield* Effect.forEach(firmInvoices, (invoice) => invoiceRepo.save(invoice));

  // Deposits before withdrawals, or Rule 10 refuses the withdrawal against a
  // balance of nothing. `trustMovements` emits them in that order.
  yield* Effect.logInfo(`Writing ${movements.length} trust movements…`);
  yield* Effect.forEach(movements, (movement) =>
    movement.reason === "Deposit received"
      ? trustRepo.recordDeposit(movement)
      : trustRepo.recordWithdrawal(movement),
  );

  // ── Verify ─────────────────────────────────────────────────────────────

  const overdrawn = yield* trustRepo.overdrawn();
  if (overdrawn.length > 0) {
    return yield* Effect.fail(
      new Error(
        `Rule 10 breached by the seeded ledger: ${overdrawn.length} client(s) ` +
          `overdrawn (${overdrawn.join(", ")}). The import is refused`,
      ),
    );
  }

  const held = yield* Effect.forEach(
    firmClients,
    (client) => trustRepo.balanceFor(client.id),
    { concurrency: 4 },
  );

  yield* Effect.logInfo(
    `Done. No client overdrawn; ${Money.format(Money.sum(held))} held on trust.`,
  );
});

export const SeedLayer = Layer.mergeAll(
  AdvocateRepositoryLive,
  CaseRepositoryLive,
  ClientRepositoryLive,
  InvoiceRepositoryLive,
  TrustRepositoryLive,
).pipe(Layer.provideMerge(PgLive));
