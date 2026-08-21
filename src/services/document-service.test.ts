import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Schema, TestClock } from "effect";
import {
  asAdvocate,
  asFinance,
  asPartner,
  asReceptionist,
  asWanjiku,
  asZenith,
  advocates,
  clients,
  filedMatter,
  matters,
  sarah,
  TODAY,
  unfiledMatter,
} from "../../test/fixtures";
import {
  inMemoryAdvocates,
  inMemoryAudit,
  inMemoryCases,
  inMemoryClients,
  inMemoryDocuments,
  inMemoryTransactor,
  restorable,
} from "../../test/in-memory-repositories";
import * as Documents from "../domain/document/document";
import type { Principal } from "../domain/identity/principal";
import { DocumentId } from "../domain/shared/ids";
import { AuditLog } from "./audit-service";
import { DocumentService, type UploadDocument } from "./document-service";
import { CurrentUser } from "./policy";

/**
 * `DocumentService`, with no database and no blob store.
 *
 * The properties under test are the ones a legal system is judged on: versions
 * cannot be lost or overwritten, a filed document cannot be revised, and a
 * client cannot reach another client's file.
 *
 * The fake store refuses to sign a key it never received, which is what makes
 * "the bytes went in before the row" testable at all — without that refusal, a
 * service that saved the row and skipped the upload would pass.
 */

const firm = (seed: readonly Documents.Document[] = []) => {
  const documents = inMemoryDocuments(seed);
  const audit = inMemoryAudit();

  return {
    documents,
    audit,
    layer: Layer.mergeAll(DocumentService.Default, AuditLog.Default).pipe(
      Layer.provideMerge(AuditLog.Default),
      Layer.provideMerge(
        Layer.mergeAll(
          documents.both,
          inMemoryCases(matters),
          inMemoryClients(clients),
          inMemoryAdvocates(advocates),
          audit.layer,
          inMemoryTransactor(restorable(documents.documentStore)),
        ),
      ),
    ),
  };
};

const scenario = <A, E>(
  body: Effect.Effect<A, E, DocumentService | AuditLog | CurrentUser>,
  options: {
    readonly as?: Principal;
    readonly seed?: readonly Documents.Document[];
  } = {},
) =>
  TestClock.setTime(TODAY).pipe(
    Effect.andThen(body),
    Effect.provideService(CurrentUser, options.as ?? asAdvocate),
    Effect.provide(firm(options.seed).layer),
  );

const particulars: UploadDocument = {
  caseId: filedMatter.id,
  name: "Plaint and verifying affidavit",
  category: "Pleadings",
  signatureStatus: "Not required",
};

const bytes = (text: string) => ({
  body: new TextEncoder().encode(text),
  contentType: "application/pdf",
});

// ── Uploading ─────────────────────────────────────────────────────────────

describe("putting a document on a file", () => {
  it.effect("starts at version one and records who uploaded it", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* DocumentService;
        const document = yield* service.upload(particulars, bytes("draft"));

        expect(document.versions).toHaveLength(1);
        expect(document.versions[0]?.number).toBe(1);
        expect(document.versions[0]?.uploadedBy).toBe(sarah.id);
        expect(document.versions[0]?.sizeBytes).toBe(5);
        expect(document.filedWithCourt).toBe(false);
      }),
    ),
  );

  /**
   * The key encodes the matter, the document and the version.
   *
   * A flat key of random ids would be shorter and would make "which matter is
   * this object on?" answerable only by joining back to Postgres — which is
   * exactly the question somebody asks when the store and the database have got
   * out of step.
   */
  it.effect("derives a storage key that says where the object belongs", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* DocumentService;
        const document = yield* service.upload(particulars, bytes("draft"));

        expect(document.versions[0]?.storageKey).toBe(
          `matters/${filedMatter.id}/${document.id}/v1`,
        );
      }),
    ),
  );

  /**
   * The bytes go in before the row.
   *
   * Asserted through the download: the fake store refuses to sign a key it
   * never received, so a service that wrote the row and skipped the upload
   * would fail here rather than hand out a URL for an object that does not
   * exist.
   */
  it.effect("stores the bytes, not just the record", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* DocumentService;
        const document = yield* service.upload(particulars, bytes("draft"));

        const download = yield* service.download(document.id);
        expect(download.url).toContain(`matters/${filedMatter.id}`);
        expect(download.name).toBe(particulars.name);
      }),
    ),
  );

  it.effect("refuses a Receptionist, who does not put documents on files", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* DocumentService;
        const refused = yield* Effect.flip(
          service.upload(particulars, bytes("draft")),
        );

        expect(refused._tag).toBe("NotPermitted");
      }),
      { as: asReceptionist },
    ),
  );

  /**
   * A client may read their own documents and may not add one.
   *
   * The grant is deliberate and so is the omission: a client uploading to their
   * own matter file is a reasonable feature and a different one, needing a
   * quarantine and a review step. Granting the verb before any of that exists
   * would be a claim the system does not honour.
   */
  it.effect("lets a client read their file and not write to it", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* DocumentService;

        const register = yield* service.register();
        expect(register).toHaveLength(0);

        const refused = yield* Effect.flip(
          service.upload(particulars, bytes("draft")),
        );
        expect(refused._tag).toBe("NotPermitted");
      }),
      { as: asWanjiku },
    ),
  );
});

// ── Revising ──────────────────────────────────────────────────────────────

describe("revising a document", () => {
  it.effect("appends a version rather than replacing one", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* DocumentService;
        const first = yield* service.upload(particulars, bytes("draft"));

        const revised = yield* service.revise(first.id, bytes("second draft"));

        expect(revised.versions).toHaveLength(2);
        expect(revised.versions.map((each) => each.number)).toEqual([1, 2]);
        // The first version's key is untouched: the object it points at is
        // still there, which is the whole point of append-only.
        expect(revised.versions[0]?.storageKey).toBe(
          first.versions[0]?.storageKey,
        );
        expect(Documents.currentVersion(revised).number).toBe(2);
      }),
    ),
  );

  /**
   * A filed document is on the court record and is fixed.
   *
   * The refusal comes from the domain, and it runs *before* anything is stored
   * — putting bytes in the store for a version that will then be refused would
   * leave an orphan for no reason.
   */
  it.effect("refuses to revise a document filed with the court", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* DocumentService;
        const first = yield* service.upload(particulars, bytes("draft"));
        yield* service.markFiled(first.id);

        const refused = yield* Effect.flip(
          service.revise(first.id, bytes("too late")),
        );

        expect(refused._tag).toBe("CannotReviseFiledDocument");
        if (refused._tag === "CannotReviseFiledDocument") {
          expect(refused.reason).toContain("a fresh document");
        }
      }),
    ),
  );

  it.effect("records a revision with both sides of the change", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* DocumentService;
        const first = yield* service.upload(particulars, bytes("draft"));
        yield* service.revise(first.id, bytes("second"));

        const audit = yield* AuditLog;
        const trail = yield* audit.trail();
        const entry = trail.find((each) => each.action === "document.revised");

        expect(Option.isSome(entry?.before ?? Option.none())).toBe(true);
        expect(Option.isSome(entry?.after ?? Option.none())).toBe(true);
      }),
      { as: asPartner },
    ),
  );
});

// ── Filing ────────────────────────────────────────────────────────────────

describe("filing with the court", () => {
  it.effect("records the moment a document becomes fixed", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* DocumentService;
        const first = yield* service.upload(particulars, bytes("draft"));

        const filed = yield* service.markFiled(first.id);
        expect(filed.filedWithCourt).toBe(true);

        const audit = yield* AuditLog;
        const trail = yield* audit.trail();
        // Its own action, not one more `document.revised`: "who decided this
        // was on the record, and when" is a question with consequences.
        expect(trail.map((each) => each.action)).toContain("document.filed");
      }),
      { as: asPartner },
    ),
  );

  it.effect("refuses to file the same document twice", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* DocumentService;
        const first = yield* service.upload(particulars, bytes("draft"));
        yield* service.markFiled(first.id);

        const refused = yield* Effect.flip(service.markFiled(first.id));
        expect(refused._tag).toBe("AlreadyFiled");
      }),
    ),
  );
});

// ── Reading ───────────────────────────────────────────────────────────────

describe("the register", () => {
  it.effect("resolves the matter and the current version", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* DocumentService;
        const first = yield* service.upload(particulars, bytes("draft"));
        yield* service.revise(first.id, bytes("second draft"));

        const register = yield* service.register();
        const entry = register.find((each) => each.document.id === first.id);

        expect(entry?.matterNumber).toBe(filedMatter.number);
        expect(entry?.versionCount).toBe(2);
        expect(entry?.current.number).toBe(2);
      }),
    ),
  );

  /**
   * A document on another client's matter is **absent**, not forbidden.
   *
   * Telling a portal user that a document exists but is not theirs confirms the
   * matter, the client, and that the firm acts for them — which for a law firm
   * is itself confidential. See `services/policy.ts`.
   */
  it.effect("hides another client's document as absence", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* DocumentService;

        // `unfiledMatter` is Zenith's; Wanjiku is asking.
        const refused = yield* Effect.flip(
          service.download(
            Schema.decodeSync(DocumentId)(
              "a0000000-0000-4000-8000-000000000001",
            ),
          ),
        );

        expect(refused._tag).toBe("NotFound");
      }),
      {
        as: asWanjiku,
        seed: [
          Documents.Document.make({
            id: Schema.decodeSync(DocumentId)(
              "a0000000-0000-4000-8000-000000000001",
            ),
            caseId: unfiledMatter.id,
            name: "Supply agreement",
            category: "Contracts",
            signatureStatus: "Signed",
            filedWithCourt: false,
            versions: [
              {
                number: 1,
                storageKey: "matters/zenith/doc/v1",
                sizeBytes: 100,
                uploadedBy: sarah.id,
                uploadedOn: TODAY,
              },
            ],
          }),
        ],
      },
    ),
  );

  /**
   * A Finance Officer does not read the matter file.
   *
   * The absence worth arguing with, and it is deliberate. Finance chases unpaid
   * fee notes and moves client money; the documents on a matter file are
   * pleadings, witness statements and privileged advice, and none of that is
   * needed to raise an invoice. Every extra role that can read the file is
   * another account whose compromise reads the file.
   */
  it.effect("keeps a Finance Officer out of the matter file", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* DocumentService;
        const refused = yield* Effect.flip(service.register());

        expect(refused._tag).toBe("NotPermitted");
        if (refused._tag === "NotPermitted") {
          expect(refused.permission).toBe("document:read");
        }
      }),
      { as: asFinance },
    ),
  );

  /**
   * A client sees their own documents and only their own.
   *
   * `document:read` is the one genuinely new grant a portal user has ever
   * received — the portal exists so a client can see their file. The scope is
   * what keeps them to it, and it is applied in the query: Zenith's own
   * document is returned and Wanjiku's matters were never read.
   */
  it.effect("gives a client their own documents and nobody else's", () =>
    scenario(
      Effect.gen(function* () {
        const service = yield* DocumentService;
        const register = yield* service.register();

        expect(register).toHaveLength(1);
        expect(register[0]?.document.caseId).toBe(unfiledMatter.id);
      }),
      {
        as: asZenith,
        seed: [
          Documents.Document.make({
            id: Schema.decodeSync(DocumentId)(
              "a0000000-0000-4000-8000-000000000001",
            ),
            caseId: unfiledMatter.id,
            name: "Supply agreement",
            category: "Contracts",
            signatureStatus: "Signed",
            filedWithCourt: false,
            versions: [
              {
                number: 1,
                storageKey: "matters/zenith/doc/v1",
                sizeBytes: 100,
                uploadedBy: sarah.id,
                uploadedOn: TODAY,
              },
            ],
          }),
        ],
      },
    ),
  );
});
