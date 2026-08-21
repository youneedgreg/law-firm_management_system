import { Either, Schema } from "effect";
import * as Documents from "@/domain/document/document";
import { CaseId } from "@/domain/shared/ids";
import type { Upload, UploadDocument } from "@/services/document-service";

/**
 * The boundary between the upload form and the document service.
 *
 * ## The file is not a form field
 *
 * Every other form in this system decodes a record of strings. This one carries
 * bytes, and bytes do not survive that treatment: `typedValues` and `submitted`
 * both keep only `typeof value === "string"`, so a `File` in the same `FormData`
 * is dropped rather than stringified. That is deliberate — it means a refused
 * upload can be shown again with the name, category and matter as they were
 * typed, and *without* a 4 MB file smuggled into a server-action return value.
 *
 * What the user loses is the file selection itself: a browser will not let a
 * page pre-fill `<input type="file">`, for good reasons, so a refused upload
 * has to be re-picked. The alternative is worse in every direction, so the form
 * says so in a hint rather than pretending otherwise.
 *
 * ## What is checked here, and what is not
 *
 * Size and emptiness are checked here because they are facts about the request
 * and the answer is the same for every caller. Whether the matter exists,
 * whether it is in scope, and whether this person may upload at all are checked
 * by `DocumentService` — asking here would duplicate a rule and let the two
 * copies drift.
 */

/**
 * Ten megabytes.
 *
 * Chosen against what actually gets filed: a scanned bundle of pleadings runs
 * to a few megabytes, and anything past ten is a video or a mistake. A Vercel
 * function will take a hundred, so this is a policy rather than a platform
 * limit, and stating it as a policy is what makes it adjustable later.
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const UploadForm = Schema.Struct({
  caseId: CaseId,
  name: Schema.NonEmptyTrimmedString,
  category: Documents.Category,
  signatureStatus: Documents.SignatureStatus,
});

export type UploadForm = typeof UploadForm.Type;

export const asUploadDocument = (form: UploadForm): UploadDocument => form;

/** Why a chosen file cannot be uploaded, in a sentence the form can show. */
export class FileRefused {
  readonly _tag = "FileRefused";
  constructor(readonly reason: string) {}
}

/**
 * The file out of a `FormData`, or a refusal.
 *
 * The bytes are read here rather than in the action so that the size check
 * happens against the real length rather than against `File.size`, which is a
 * claim the browser makes.
 */
export const fileFrom = async (
  form: FormData,
  field: string,
): Promise<
  Either.Either<Upload & { readonly filename: string }, FileRefused>
> => {
  const chosen = form.get(field);

  if (!(chosen instanceof File) || chosen.size === 0) {
    return Either.left(new FileRefused("Choose a file to upload."));
  }

  if (chosen.size > MAX_UPLOAD_BYTES) {
    return Either.left(
      new FileRefused(
        `That file is ${megabytes(chosen.size)} MB. The limit is ` +
          `${String(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`,
      ),
    );
  }

  const body = new Uint8Array(await chosen.arrayBuffer());

  if (body.byteLength === 0) {
    return Either.left(new FileRefused("That file is empty."));
  }

  if (body.byteLength > MAX_UPLOAD_BYTES) {
    return Either.left(
      new FileRefused(
        `That file is ${megabytes(body.byteLength)} MB. The limit is ` +
          `${String(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`,
      ),
    );
  }

  return Either.right({
    body,
    /**
     * `application/octet-stream` when the browser offers nothing. Guessing from
     * the extension would be a second, worse source of the same fact, and the
     * content type only decides how a browser *offers* the download — it is not
     * a security control, because the store is private and the URL is signed.
     */
    contentType:
      chosen.type.trim() === "" ? "application/octet-stream" : chosen.type,
    filename: chosen.name,
  });
};

const megabytes = (bytes: number): string =>
  (Math.round((bytes / 1024 / 1024) * 10) / 10).toFixed(1);

/** A human size for the register, which shows one per row. */
export const formatSize = (bytes: number): string =>
  bytes < 1024
    ? `${String(bytes)} B`
    : bytes < 1024 * 1024
      ? `${String(Math.round(bytes / 1024))} KB`
      : `${megabytes(bytes)} MB`;
