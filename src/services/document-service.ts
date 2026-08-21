import { DateTime, Effect, Either, Schema } from "effect";
import * as Documents from "../domain/document/document";
import type { NotPermitted } from "../domain/identity/permissions";
import type { Principal } from "../domain/identity/principal";
import { AdvocateId, CaseId, DocumentId } from "../domain/shared/ids";
import { AuditLog } from "./audit-service";
import { type CurrentUser, permitted, scope, withinScope } from "./policy";
import {
  AdvocateRepository,
  CaseRepository,
  DocumentRepository,
  DocumentStore,
  type NotFound,
  type RepositoryFailure,
  type StorageFailure,
  Transactor,
  type VersionAlreadyExists,
} from "./repositories";

/**
 * Documents on a matter file.
 *
 * Two things this layer is responsible for, and the second is the one that
 * matters for a legal system.
 *
 * **Versions are append-only, all the way down.** The domain refuses to revise
 * a filed document, `document_versions` is keyed on `(document_id, number)` so
 * a version cannot be written over, and the version number is claimed inside a
 * transaction so two uploads racing cannot both be version 4. A pleading that
 * was filed is evidence of what was said at that moment; "what did the version
 * we filed actually say" is a question that comes up constantly, and a system
 * that answers it with the current contents is a system that has destroyed the
 * answer.
 *
 * **The bytes never pass through the application.** `download` checks the
 * permission and the scope and then mints a fifteen-minute signed URL; the
 * browser fetches the CDN directly. Streaming a 40 MB bundle of pleadings
 * through a serverless function, twice, for every download, is the alternative.
 * The authorisation is not weakened by that: it happens *before* the URL
 * exists, and the URL grants exactly what the service already decided the
 * caller may have.
 */

// ── What the screens read ─────────────────────────────────────────────────

/** A document with the matter it sits on, and its current version. */
export interface DocumentSummary {
  readonly document: Documents.Document;
  readonly matterNumber: string;
  readonly matterTitle: string;
  readonly current: Documents.Version;
  readonly versionCount: number;
}

/**
 * One document, with the names behind its versions.
 *
 * `uploaders` is a lookup rather than a name folded into each version, because
 * the same advocate uploads most of them and the domain stores an id — a
 * `Version` carrying a display name would be a copy of a fact that lives in the
 * staff table, and copies go stale.
 *
 * A missing name resolves to a placeholder at the point of use rather than
 * failing the read: the foreign key makes it impossible in Postgres, and a
 * document should not fail to open because one row is odd.
 */
export interface DocumentOnFile extends DocumentSummary {
  readonly uploaders: Readonly<Record<string, string>>;
}

/** A signed URL, and how long it is good for. */
export interface Download {
  readonly url: string;
  readonly name: string;
  readonly expiresAt: Date;
}

/** Fifteen minutes, matching `DocumentStoreLive`. */
const WINDOW_MS = 15 * 60 * 1000;

// ── What the boundary accepts ─────────────────────────────────────────────

/**
 * Putting a document on a file.
 *
 * `versions` is absent, and `storageKey` with it: a caller does not choose
 * where bytes live. The key is derived from the matter, the document and the
 * version number, so the object in the store is findable from the row that
 * points at it — which is the one property the mapping has to keep.
 */
export const UploadDocument = Schema.Struct({
  caseId: CaseId,
  name: Schema.NonEmptyTrimmedString,
  category: Documents.Category,
  signatureStatus: Schema.optionalWith(Documents.SignatureStatus, {
    default: (): Documents.SignatureStatus => "Not required",
  }),
});

export type UploadDocument = typeof UploadDocument.Type;

/** The bytes, separated from the particulars because they travel differently. */
export interface Upload {
  readonly body: Uint8Array;
  readonly contentType: string;
}

// ── Failures this layer adds ──────────────────────────────────────────────

/** Only somebody with a staff record uploads: a version records who did. */
export class NotAnUploader extends Schema.TaggedError<NotAnUploader>()(
  "NotAnUploader",
  { name: Schema.String },
) {
  get reason(): string {
    return `${this.name} has no staff record, so an upload cannot be attributed to them`;
  }
}

/**
 * A document already filed with the court cannot be filed again.
 *
 * Distinct from `CannotReviseFiledDocument`, which is about adding a version.
 * This is about the flag itself: marking a document as filed is the moment it
 * becomes fixed, and doing it twice would put a second entry in the trail for
 * something that happened once.
 */
export class AlreadyFiled extends Schema.TaggedError<AlreadyFiled>()(
  "AlreadyFiled",
  { name: Schema.String },
) {
  get reason(): string {
    return `"${this.name}" is already recorded as filed with the court`;
  }
}

export type CannotUpload =
  NotPermitted | NotAnUploader | NotFound | StorageFailure | RepositoryFailure;

// ── Helpers ───────────────────────────────────────────────────────────────

const enforce = <A, E>(result: Either.Either<A, E>): Effect.Effect<A, E> =>
  Either.match(result, {
    onLeft: Effect.fail,
    onRight: Effect.succeed<A>,
  });

const uploaderOf = (
  principal: Principal,
): Effect.Effect<AdvocateId, NotAnUploader> =>
  principal._tag === "Staff"
    ? Effect.succeed(principal.advocateId)
    : Effect.fail(new NotAnUploader({ name: principal.name }));

const documentId = (): DocumentId =>
  Schema.decodeSync(DocumentId)(crypto.randomUUID());

/**
 * Where a version's bytes live.
 *
 * `matters/<caseId>/<documentId>/v<n>` — derived, never chosen, and structured
 * so that the store can be read by a person. A flat key of random ids would be
 * shorter and would make "which matter is this object on?" answerable only by
 * joining back to Postgres, which is precisely the question somebody asks when
 * the two have got out of step.
 *
 * The version number is in the key rather than the object being overwritten,
 * which is what makes the *store* append-only too. Overwriting would leave the
 * row saying there are four versions and the store holding one.
 */
const keyFor = (caseId: CaseId, id: DocumentId, version: number): string =>
  `matters/${caseId}/${id}/v${String(version)}`;

// ── The service ───────────────────────────────────────────────────────────

export class DocumentService extends Effect.Service<DocumentService>()(
  "DocumentService",
  {
    effect: Effect.gen(function* () {
      const documents = yield* DocumentRepository;
      const cases = yield* CaseRepository;
      const advocates = yield* AdvocateRepository;
      const store = yield* DocumentStore;
      const audit = yield* AuditLog;
      const transactor = yield* Transactor;

      /**
       * One document, with the matter it sits on, scoped.
       *
       * Two hops, like a hearing and a time entry: a document belongs to a
       * matter and the matter belongs to a client. A portal user reading the
       * documents on somebody else's file is the failure this prevents, and it
       * answers `NotFound` rather than a refusal — see `services/policy.ts`.
       */
      const scoped = (
        id: DocumentId,
        permission: "document:read" | "document:write",
      ) =>
        Effect.gen(function* () {
          yield* permitted(permission);
          const document = yield* documents.byId(id);
          const matter = yield* cases.byId(document.caseId);
          yield* withinScope("document", id, matter.clientId);
          return { document, matter };
        });

      return {
        /**
         * The document register, scoped in the query.
         *
         * A portal user sees the documents on their own matters — which is what
         * the portal is for — and the matters were read by a scoped query, so
         * the rows they may not see are never loaded.
         */
        register: (): Effect.Effect<
          readonly DocumentSummary[],
          NotPermitted | NotFound | RepositoryFailure,
          CurrentUser
        > =>
          Effect.gen(function* () {
            yield* permitted("document:read");
            const visible = yield* scope;

            const everyMatter = yield* visible._tag === "WholeFirm"
              ? cases.all()
              : cases.forClient(visible.clientId);

            const matters = new Map(
              everyMatter.map((matter) => [matter.id, matter] as const),
            );

            const held = yield* visible._tag === "WholeFirm"
              ? documents.all()
              : Effect.map(
                  Effect.forEach(
                    everyMatter,
                    (matter) => documents.forCase(matter.id),
                    { concurrency: "unbounded" },
                  ),
                  (each) => each.flat(),
                );

            return held
              .filter((document) => matters.has(document.caseId))
              .map((document): DocumentSummary => {
                const matter = matters.get(document.caseId);
                return {
                  document,
                  matterNumber: matter?.number ?? "—",
                  matterTitle: matter?.title ?? "Unknown matter",
                  current: Documents.currentVersion(document),
                  versionCount: Documents.versionCount(document),
                };
              });
          }),

        /**
         * One document, for the page that shows its history.
         *
         * A thin wrapper over `scoped`, and worth having rather than making the
         * page read the whole register and filter it: filtering client-side
         * would mean loading every document the caller may see in order to show
         * one, and would answer "not in the list" where this answers `NotFound`
         * with the scope check that makes the two indistinguishable.
         */
        byId: (
          id: DocumentId,
        ): Effect.Effect<
          DocumentOnFile,
          NotPermitted | NotFound | RepositoryFailure,
          CurrentUser
        > =>
          Effect.gen(function* () {
            const { document, matter } = yield* scoped(id, "document:read");

            /**
             * Only the advocates this document's versions name, not the whole
             * staff list. A page showing three versions has no business
             * reading the firm's directory to label them.
             */
            const named = yield* Effect.forEach(
              [...new Set(document.versions.map((v) => v.uploadedBy))],
              (advocateId) =>
                Effect.map(
                  advocates.byId(advocateId),
                  (advocate) => [advocateId, advocate.name] as const,
                ),
              { concurrency: "unbounded" },
            );

            return {
              document,
              matterNumber: matter.number,
              matterTitle: matter.title,
              current: Documents.currentVersion(document),
              versionCount: Documents.versionCount(document),
              uploaders: Object.fromEntries(named),
            };
          }),

        /** Every document on one matter. */
        forCase: (
          caseId: CaseId,
        ): Effect.Effect<
          readonly Documents.Document[],
          NotPermitted | NotFound | RepositoryFailure,
          CurrentUser
        > =>
          Effect.gen(function* () {
            yield* permitted("document:read");
            const matter = yield* cases.byId(caseId);
            yield* withinScope("case", caseId, matter.clientId);
            return yield* documents.forCase(caseId);
          }),

        /**
         * A short-lived URL for the current version.
         *
         * The permission and the scope are checked *first*, and the signature is
         * minted only afterwards — so the URL grants exactly what this service
         * has already decided the caller may have. Whoever then holds the URL
         * holds it for fifteen minutes, which is the trade a CDN download makes
         * and is stated rather than hidden.
         */
        download: (
          id: DocumentId,
        ): Effect.Effect<
          Download,
          NotPermitted | NotFound | StorageFailure | RepositoryFailure,
          CurrentUser
        > =>
          Effect.gen(function* () {
            const { document } = yield* scoped(id, "document:read");
            const current = Documents.currentVersion(document);

            const [url, now] = yield* Effect.all([
              store.signedUrl(current.storageKey),
              DateTime.nowAsDate,
            ]);

            return {
              url,
              name: document.name,
              expiresAt: new Date(now.getTime() + WINDOW_MS),
            };
          }),

        /**
         * Puts a document on a matter file.
         *
         * **The bytes go to the store first, and the row second.** That
         * ordering is deliberate and the failure modes are not symmetrical: a
         * stored object with no row is an orphan nobody can reach, costing a
         * few kilobytes until somebody sweeps it; a row with no object is a
         * document the file says exists and nobody can open, which is the one a
         * client notices. Given that only one of the two can be atomic, the
         * cheap failure is the one to choose.
         */
        upload: (
          input: UploadDocument,
          bytes: Upload,
        ): Effect.Effect<Documents.Document, CannotUpload, CurrentUser> =>
          Effect.gen(function* () {
            const principal = yield* permitted("document:write");
            const uploadedBy = yield* uploaderOf(principal);

            const matter = yield* cases.byId(input.caseId);
            yield* withinScope("case", input.caseId, matter.clientId);

            const id = documentId();
            const key = keyFor(input.caseId, id, 1);

            const [{ sizeBytes }, uploadedOn] = yield* Effect.all([
              store.put(key, bytes.body, bytes.contentType),
              DateTime.nowAsDate,
            ]);

            const document = Documents.Document.make({
              id,
              caseId: input.caseId,
              name: input.name,
              category: input.category,
              signatureStatus: input.signatureStatus,
              filedWithCourt: false,
              versions: [
                {
                  number: 1,
                  storageKey: key,
                  sizeBytes,
                  uploadedBy,
                  uploadedOn,
                },
              ],
            });

            return yield* transactor.transaction(
              Effect.gen(function* () {
                const saved = yield* documents.save(document);
                yield* audit.record({
                  action: "document.uploaded",
                  entity: "document",
                  entityId: saved.id,
                  after: saved,
                });
                return saved;
              }),
            );
          }),

        /**
         * Adds a version, refusing to revise anything already filed.
         *
         * The domain's `addVersion` computes the next number from the versions
         * it can see, which is a race — and the `(document_id, number)` primary
         * key is the arbiter, exactly as `cases.number` is for a matter
         * reference. The loser is refused and this retries onto the next free
         * number rather than overwriting somebody else's upload.
         */
        revise: (
          id: DocumentId,
          bytes: Upload,
        ): Effect.Effect<
          Documents.Document,
          | NotPermitted
          | NotAnUploader
          | Documents.CannotReviseFiledDocument
          | VersionAlreadyExists
          | NotFound
          | StorageFailure
          | RepositoryFailure,
          CurrentUser
        > =>
          Effect.gen(function* () {
            const principal = yield* permitted("document:write");
            const uploadedBy = yield* uploaderOf(principal);
            const { document } = yield* scoped(id, "document:write");

            const uploadedOn = yield* DateTime.nowAsDate;
            const nextNumber = Documents.currentVersion(document).number + 1;
            const key = keyFor(document.caseId, id, nextNumber);

            /**
             * The domain's refusal runs *before* anything is stored.
             *
             * A filed document is on the court record; putting bytes in the
             * store for a version that will then be refused would leave an
             * orphan for no reason.
             */
            const revised = yield* enforce(
              Documents.addVersion(document, {
                storageKey: key,
                sizeBytes: bytes.body.byteLength,
                uploadedBy,
                uploadedOn,
              }),
            );

            const { sizeBytes } = yield* store.put(
              key,
              bytes.body,
              bytes.contentType,
            );

            const version = {
              number: nextNumber,
              storageKey: key,
              sizeBytes,
              uploadedBy,
              uploadedOn,
            };

            return yield* transactor.transaction(
              Effect.gen(function* () {
                yield* documents.addVersion(id, version);
                yield* audit.record({
                  action: "document.revised",
                  entity: "document",
                  entityId: id,
                  before: document,
                  after: revised,
                });
                return revised;
              }),
            );
          }).pipe(
            Effect.retry({
              times: 3,
              while: (error) => error._tag === "VersionAlreadyExists",
            }),
          ),

        /**
         * Records that a document has been filed with the court.
         *
         * The moment it becomes fixed: `addVersion` refuses a filed document
         * from here on, because the firm's copy and the court's copy differing
         * under the same name is worse than two clearly separate documents. It
         * has its own audit action for the same reason — "who decided this was
         * on the record, and when" is a question with consequences.
         *
         * There is no operation to *un*-file. Filing is a fact about the world
         * rather than a flag about this system, and a mistake is corrected by
         * saying so in a note, not by making the record say it never happened.
         */
        markFiled: (
          id: DocumentId,
        ): Effect.Effect<
          Documents.Document,
          NotPermitted | AlreadyFiled | NotFound | RepositoryFailure,
          CurrentUser
        > =>
          Effect.gen(function* () {
            const { document } = yield* scoped(id, "document:write");

            if (document.filedWithCourt) {
              return yield* Effect.fail(
                new AlreadyFiled({ name: document.name }),
              );
            }

            const filed = { ...document, filedWithCourt: true };

            return yield* transactor.transaction(
              Effect.gen(function* () {
                const saved = yield* documents.save(filed);
                yield* audit.record({
                  action: "document.filed",
                  entity: "document",
                  entityId: saved.id,
                  before: document,
                  after: saved,
                });
                return saved;
              }),
            );
          }),
      };
    }),
  },
) {}
