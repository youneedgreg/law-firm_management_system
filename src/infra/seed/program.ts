import { SqlClient } from "@effect/sql";
import { Effect, Either, Layer } from "effect";
import * as Money from "../../domain/shared/money";
import {
  AdvocateRepository,
  CaseRepository,
  ClientRepository,
  ContactRepository,
  DocumentRepository,
  AppointmentRepository,
  MessageRepository,
  PrecedentRepository,
  TaskRepository,
  DocumentStore,
  InvoiceRepository,
  HearingRepository,
  TimeRepository,
  TrustRepository,
} from "../../services/repositories";
import { AuthLive } from "../auth/auth";
import { DocumentStoreLive } from "../blob/store";
import { DeploymentConfig } from "../config";
import { AdvocateRepositoryLive } from "../sql/advocate-repository";
import { CaseRepositoryLive } from "../sql/case-repository";
import { PgLive } from "../sql/client";
import { ClientRepositoryLive } from "../sql/client-repository";
import { DocumentRepositoryLive } from "../sql/document-repository";
import { TaskRepositoryLive } from "../sql/task-repository";
import { AppointmentRepositoryLive } from "../sql/appointment-repository";
import { MessageRepositoryLive } from "../sql/message-repository";
import {
  ContactRepositoryLive,
  PrecedentRepositoryLive,
} from "../sql/firm-records-repository";
import { InvoiceRepositoryLive } from "../sql/invoice-repository";
import { HearingRepositoryLive } from "../sql/hearing-repository";
import { TimeRepositoryLive } from "../sql/time-repository";
import { TrustRepositoryLive } from "../sql/trust-repository";
import { UserRepositoryLive } from "../sql/user-repository";
import { CASES } from "../../lib/data/cases";
import { stableId } from "./ids";
import { provisionLogins } from "./logins";
import {
  advocates,
  clientIdsByPrototypeKey,
  clients,
  documents,
  contacts,
  invoices,
  appointments,
  messages,
  precedents,
  tasks,
  hearings,
  matters,
  PORTAL_CLIENT_NUMBER,
  type SeedProblem,
  timeEntries,
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
  yield* sql`DELETE FROM time_entries`;
  yield* sql`DELETE FROM appointments`;
  yield* sql`DELETE FROM hearings`;
  yield* sql`DELETE FROM tasks`;
  /**
   * `messages` before `clients` and `cases`, and both of those reference it
   * with `RESTRICT` rather than `CASCADE` — correspondence is not something
   * this schema throws away as a side effect. The wipe deletes it deliberately,
   * which is the only way it goes.
   */
  /**
   * `TRUNCATE`, not `DELETE`, and the difference is the point.
   *
   * The append-only trigger on `messages` refuses a row delete — correctly, and
   * it refused this wipe the first time it ran. A trigger cannot be argued with
   * from application code, and disabling it for the seed would be exactly the
   * escape hatch that makes the guarantee worthless.
   *
   * `TRUNCATE` does not fire row triggers, and that is not a loophole: it is a
   * different operation, at a different level, meaning "empty this table" rather
   * than "remove these rows". A seed resetting a demo dataset is doing the
   * former; nothing in the application can do either.
   */
  yield* sql`TRUNCATE messages`;
  yield* sql`DELETE FROM contacts`;
  yield* sql`DELETE FROM precedents`;
  // Versions cascade from documents. The *objects* are deliberately not
  // deleted: a wipe that reached into blob storage would delete anything a
  // demo upload had put there, and re-seeding overwrites the seeded keys
  // anyway. Orphaned objects cost storage; deleted ones cost a document.
  yield* sql`DELETE FROM documents`;
  yield* sql`DELETE FROM payments`;
  yield* sql`DELETE FROM invoice_lines`;
  yield* sql`DELETE FROM invoices`;
  yield* sql`DELETE FROM cases`;
  // Logins point at the two tables below, so they go first. `sessions` and
  // `accounts` cascade from `users`; the audit trail deliberately does not —
  // it outlives the accounts it names, which is the whole point of copying the
  // actor's name into it rather than joining.
  yield* sql`DELETE FROM users`;
  yield* sql`DELETE FROM client_contacts`;
  yield* sql`DELETE FROM clients`;
  yield* sql`DELETE FROM advocates`;
});

export const seed = Effect.gen(function* () {
  /**
   * The demonstration dataset only loads onto the demonstration (D-11).
   *
   * This is the third place the question is asked, and the one that covers the
   * path the other two do not: `npm run db:seed`, run from a laptop against
   * whatever `DATABASE_URL` happens to be exported. The route and
   * `resetDemoData` guard the cron; nothing guarded a person with a terminal
   * and the wrong environment file, and `wipe` below empties twenty-three
   * tables before it writes anything.
   *
   * At the top, before a single repository is resolved, so a refusal costs
   * nothing and — more to the point — happens before the wipe rather than
   * somewhere in the middle of it.
   *
   * The message names the variable because the person who sees this is either
   * about to make a serious mistake, or is running the seed locally and has not
   * set `.env.local` up yet. Those two need to be told apart by a human, so it
   * says what is true and what would change it rather than guessing which one
   * this is.
   */
  const deployment = yield* DeploymentConfig;

  if (!deployment.isDemo) {
    return yield* Effect.fail(
      new Error(
        "Refused: the seed wipes every table it owns and loads fixtures for a " +
          "firm that does not exist, so it runs only where DEMO_DEPLOYMENT is " +
          "set. If this is the demonstration, set DEMO_DEPLOYMENT=true. If it " +
          "is a firm's installation, this is not the program you want.",
      ),
    );
  }

  const advocateRepo = yield* AdvocateRepository;
  const clientRepo = yield* ClientRepository;
  const caseRepo = yield* CaseRepository;
  const invoiceRepo = yield* InvoiceRepository;
  const trustRepo = yield* TrustRepository;
  const timeRepo = yield* TimeRepository;
  const hearingRepo = yield* HearingRepository;
  const documentRepo = yield* DocumentRepository;
  const store = yield* DocumentStore;
  const taskRepo = yield* TaskRepository;
  const messageRepo = yield* MessageRepository;
  const appointmentRepo = yield* AppointmentRepository;
  const contactRepo = yield* ContactRepository;
  const precedentRepo = yield* PrecedentRepository;

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

  const recorded = yield* adapted(
    "time",
    timeEntries(caseIdsByNumber, advocateIds),
  );

  /**
   * Keyed by the prototype's integer, not by matter number: `HEARINGS` points
   * at `caseId`, and `stableId` is a pure function of that key.
   */
  const caseIdsByPrototypeId = new Map(
    CASES.map((legalCase) => [legalCase.id, stableId("case", legalCase.id)]),
  );

  const courtDates = yield* adapted(
    "hearing",
    hearings(caseIdsByPrototypeId, advocateIds),
  );

  const register = yield* adapted(
    "document",
    documents(caseIdsByNumber, advocateIds),
  );

  const workList = yield* adapted("task", tasks(caseIdsByNumber, advocateIds));

  /**
   * Keyed by client *number* rather than by the prototype's integer: the
   * seeded thread names clients the way a person would.
   */
  const clientIdsByNumber = new Map(
    firmClients.map((client) => [client.number, client.id]),
  );

  const thread = yield* adapted(
    "message",
    messages(clientIdsByNumber, caseIdsByNumber, advocateIds),
  );

  const contactLog = yield* adapted(
    "contact",
    contacts(clientIdsByName, caseIdsByNumber, advocateIds),
  );

  const bank = yield* adapted("precedent", precedents(advocateIds));

  const diary = yield* adapted(
    "appointment",
    appointments(clientIdsByName, caseIdsByNumber, advocateIds),
  );

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

  yield* Effect.logInfo(`Writing ${recorded.length} time entries…`);
  yield* Effect.forEach(recorded, (entry) => timeRepo.save(entry));

  yield* Effect.logInfo(`Writing ${courtDates.length} court dates…`);
  yield* Effect.forEach(courtDates, (hearing) => hearingRepo.save(hearing));

  /**
   * Bodies before rows, which is the same order `DocumentService.upload` uses
   * and for the same reason: an object in the store with no row pointing at it
   * is invisible and costs a fraction of a cent, while a row pointing at an
   * object that was never written is a document the register offers and the
   * download refuses.
   *
   * **Each key is removed before it is written**, because the store refuses to
   * overwrite. That refusal is deliberate — it is what stops the bytes under a
   * version changing while the row that describes them does not — so a second
   * seed run has to say explicitly that it is replacing the demo dataset,
   * rather than reaching for an overwrite flag that would weaken the guarantee
   * for every caller. `remove` on a key that is not there is a no-op, so a
   * first run pays one wasted call per body and stays idempotent.
   */
  const bodies = register.flatMap((entry) => entry.bodies);
  yield* Effect.logInfo(`Uploading ${bodies.length} document bodies…`);
  yield* Effect.forEach(
    bodies,
    (body) =>
      store
        .remove(body.key)
        .pipe(Effect.andThen(store.put(body.key, body.body, "text/plain"))),
    { concurrency: 4 },
  );

  yield* Effect.logInfo(`Writing ${register.length} documents…`);
  yield* Effect.forEach(register, (entry) => documentRepo.save(entry.document));

  yield* Effect.logInfo(`Writing ${workList.length} tasks…`);
  yield* Effect.forEach(workList, (task) => taskRepo.save(task));

  yield* Effect.logInfo(`Writing ${thread.length} messages…`);
  yield* Effect.forEach(thread, (message) => messageRepo.send(message));

  yield* Effect.logInfo(`Writing ${contactLog.length} logged conversations…`);
  yield* Effect.forEach(contactLog, (contact) => contactRepo.log(contact));

  yield* Effect.logInfo(`Writing ${bank.length} precedents…`);
  yield* Effect.forEach(bank, (precedent) => precedentRepo.save(precedent));

  yield* Effect.logInfo(`Writing ${diary.length} appointments…`);
  yield* Effect.forEach(diary, (appointment) =>
    appointmentRepo.save(appointment),
  );

  yield* Effect.logInfo("Provisioning logins…");
  const logins = yield* provisionLogins(
    staff,
    firmClients,
    PORTAL_CLIENT_NUMBER,
  );
  yield* Effect.logInfo(
    `${logins.staff} staff logins, and ${logins.portal} for the portal.`,
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
  /**
   * Merged rather than provided, because the guard at the top of `seed` asks
   * for it directly (D-11). It reads one environment variable and reaches
   * nothing, so it sits outside the `Layer.provide(PgLive)` below with the
   * things that are not repositories.
   */
  DeploymentConfig.Default,
  AdvocateRepositoryLive,
  UserRepositoryLive,
  CaseRepositoryLive,
  ClientRepositoryLive,
  InvoiceRepositoryLive,
  TrustRepositoryLive,
  TimeRepositoryLive,
  HearingRepositoryLive,
  DocumentRepositoryLive,
  DocumentStoreLive,
  TaskRepositoryLive,
  MessageRepositoryLive,
  AppointmentRepositoryLive,
  ContactRepositoryLive,
  PrecedentRepositoryLive,
).pipe(Layer.provideMerge(PgLive), Layer.merge(AuthLive));
