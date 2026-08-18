import { Either, Schema } from "effect";
import { AdvocateId, CaseId, DocumentId } from "../shared/ids";

/**
 * Documents on a matter file.
 *
 * Versions are append-only. A pleading that has been filed, or an agreement
 * that has been signed, is evidence of what was said at that moment — replacing
 * its contents destroys that, and the question "what did the version we filed
 * actually say?" comes up constantly. So a new version is a new entry, and the
 * current version is simply the latest one.
 */

export const CATEGORIES = [
  "Pleadings",
  "Contracts",
  "Witness Statements",
  "Affidavits",
  "Judgments",
  "Correspondence",
  "Attendance Notes",
] as const;

export const Category = Schema.Literal(...CATEGORIES);
export type Category = typeof Category.Type;

export const Version = Schema.Struct({
  number: Schema.Int.pipe(Schema.positive()),
  /** Where the bytes live. Blob storage, in Phase 7. */
  storageKey: Schema.NonEmptyTrimmedString,
  sizeBytes: Schema.Int.pipe(Schema.positive()),
  uploadedBy: AdvocateId,
  uploadedOn: Schema.DateFromSelf,
});

export type Version = typeof Version.Type;

export const SIGNATURE_STATUSES = [
  "Not required",
  "Awaiting signature",
  "Signed",
] as const;

export const SignatureStatus = Schema.Literal(...SIGNATURE_STATUSES);
export type SignatureStatus = typeof SignatureStatus.Type;

export const Document = Schema.Struct({
  id: DocumentId,
  caseId: CaseId,
  name: Schema.NonEmptyTrimmedString,
  category: Category,
  signatureStatus: SignatureStatus,
  /** Newest last. Never empty: a document with no version is just a name. */
  versions: Schema.NonEmptyArray(Version),
  /** Filed at court, and therefore fixed. */
  filedWithCourt: Schema.Boolean,
});

export type Document = typeof Document.Type;

export const currentVersion = (document: Document): Version =>
  document.versions[document.versions.length - 1] ?? document.versions[0];

export const versionCount = (document: Document): number =>
  document.versions.length;

export class CannotReviseFiledDocument extends Schema.TaggedError<CannotReviseFiledDocument>()(
  "CannotReviseFiledDocument",
  { name: Schema.String },
) {
  get reason(): string {
    return (
      `"${this.name}" has been filed with the court. Filed documents are fixed; ` +
      `a correction is a fresh document, not a new version of this one`
    );
  }
}

/**
 * Adds a version, refusing to revise anything already filed.
 *
 * A filed document is on the court record. Adding a version to it locally would
 * leave the firm's copy and the court's copy differing under the same name,
 * which is worse than having two clearly separate documents.
 *
 * The version number is assigned here rather than accepted from the caller —
 * two people uploading at once would otherwise both claim version 4.
 */
export const addVersion = (
  document: Document,
  version: Omit<Version, "number">,
): Either.Either<Document, CannotReviseFiledDocument> => {
  if (document.filedWithCourt) {
    return Either.left(new CannotReviseFiledDocument({ name: document.name }));
  }

  const next: Version = {
    ...version,
    number: currentVersion(document).number + 1,
  };

  return Either.right({
    ...document,
    versions: [...document.versions, next],
  });
};

/** Documents still waiting on a signature. */
export const awaitingSignature = (
  documents: readonly Document[],
): readonly Document[] =>
  documents.filter(
    (document) => document.signatureStatus === "Awaiting signature",
  );
