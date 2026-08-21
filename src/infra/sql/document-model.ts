import { Model } from "@effect/sql";
import { ParseResult, Schema } from "effect";
import * as Documents from "../../domain/document/document";
import { AdvocateId, CaseId, DocumentId } from "../../domain/shared/ids";
import { Cents } from "./columns";

/**
 * The `documents` and `document_versions` tables, and the bridge to a
 * `Document`.
 *
 * An aggregate across two tables, like an invoice — and with the same rule
 * behind it: **a document with no version is just a name**, so `versions` is a
 * `NonEmptyArray` in the domain and this refuses a row that has none. Postgres
 * cannot express "at least one child row" with a constraint, so the refusal
 * lives here, exactly as it does for a corporate client's contacts and an
 * invoice's lines.
 *
 * `size_bytes` reuses `Cents` — not because a file size is money, but because
 * the column is `bigint` and `Cents` is the schema that refuses a `bigint`
 * arriving as a string it cannot round-trip. The name is wrong for this use and
 * the behaviour is exactly right; a `BigintFromString` alias would be the
 * honest fix and is a rename, not a change.
 */
export class DocumentRow extends Model.Class<DocumentRow>("DocumentRow")({
  id: DocumentId,
  caseId: CaseId,
  name: Schema.NonEmptyTrimmedString,
  category: Documents.Category,
  signatureStatus: Documents.SignatureStatus,
  filedWithCourt: Schema.Boolean,
  createdAt: Model.Generated(Schema.DateFromSelf),
}) {}

/**
 * A version row.
 *
 * `number` is part of the primary key with `document_id`, which is what makes
 * versions append-only in storage as well as in the domain: a second write of
 * version 4 is refused by the key rather than overwriting the first.
 */
export class VersionRow extends Model.Class<VersionRow>("VersionRow")({
  documentId: DocumentId,
  number: Schema.Int.pipe(Schema.positive()),
  storageKey: Schema.NonEmptyTrimmedString,
  sizeBytes: Cents,
  uploadedBy: AdvocateId,
  uploadedOn: Schema.DateFromSelf,
}) {}

/** The aggregate, as two queries hand it over. */
export const DocumentRowWithVersions = Schema.Struct({
  document: DocumentRow.insert,
  versions: Schema.Array(VersionRow.insert),
});

export const DocumentFromRow = Schema.transformOrFail(
  DocumentRowWithVersions,
  Schema.typeSchema(Documents.Document),
  {
    strict: true,

    decode: ({ document, versions }, _options, ast) => {
      if (versions.length === 0) {
        return ParseResult.fail(
          new ParseResult.Type(
            ast,
            document,
            `"${document.name}" has no versions. A document with no version is ` +
              `just a name, and nothing downstream can decide what that means`,
          ),
        );
      }

      /**
       * Ordered by version number, oldest first.
       *
       * `currentVersion` is "the last one", so an unordered list would make the
       * current version whichever row Postgres happened to return — the same
       * defect migration 0002 fixed for a client's contacts, and the same
       * remedy: the order is meaning, so it is not left to chance.
       */
      const ordered = [...versions].sort((a, b) => a.number - b.number);
      const [first, ...rest] = ordered as [
        (typeof ordered)[number],
        ...(typeof ordered)[number][],
      ];

      const asVersion = (row: typeof first): Documents.Version => ({
        number: row.number,
        storageKey: row.storageKey,
        sizeBytes: row.sizeBytes,
        uploadedBy: row.uploadedBy,
        uploadedOn: row.uploadedOn,
      });

      return ParseResult.succeed({
        id: document.id,
        caseId: document.caseId,
        name: document.name,
        category: document.category,
        signatureStatus: document.signatureStatus,
        filedWithCourt: document.filedWithCourt,
        versions: [asVersion(first), ...rest.map(asVersion)] as const,
      });
    },

    encode: (document) =>
      ParseResult.succeed({
        document: {
          id: document.id,
          caseId: document.caseId,
          name: document.name,
          category: document.category,
          signatureStatus: document.signatureStatus,
          filedWithCourt: document.filedWithCourt,
        },
        versions: document.versions.map((version) => ({
          documentId: document.id,
          number: version.number,
          storageKey: version.storageKey,
          sizeBytes: version.sizeBytes,
          uploadedBy: version.uploadedBy,
          uploadedOn: version.uploadedOn,
        })),
      }),
  },
).annotations({ identifier: "DocumentFromRow" });
