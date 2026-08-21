import { del, issueSignedToken, presignUrl, put } from "@vercel/blob";
import { Config, Effect, Layer, Redacted } from "effect";
import { DocumentStore, StorageFailure } from "../../services/repositories";

/**
 * Document bytes, in Vercel Blob (D-4).
 *
 * The store is **private**. That is the whole reason this file is more than
 * three lines: a public blob URL is a permanent, unauthenticated grant to
 * whoever ever sees it, and legal documents are the last thing that should have
 * one. Somebody forwarding a link to a pleading in a group chat should not be
 * publishing it.
 *
 * ## How a private read works, and why the application never sees the bytes
 *
 * A CDN fetch carries no session, so authorisation has to be *in the URL*.
 * `issueSignedToken` asks the control API for short-lived signing material
 * scoped to one pathname and to reads only; `presignUrl` then signs a concrete
 * object URL with it. The browser fetches that URL directly from the CDN.
 *
 * The alternative — streaming the bytes through a route handler that checks the
 * session — is simpler to reason about and much worse in practice: a 40 MB
 * bundle of pleadings would cross the network twice, through a serverless
 * function with a memory limit and an execution budget, for every download.
 *
 * The authorisation is still real, and it happens *before* the URL is minted:
 * `DocumentService.download` checks `document:read` and the caller's scope, and
 * only then asks for a signature. What the URL grants is what the service has
 * already decided the caller may have.
 *
 * Fifteen minutes is the window. Long enough to open a document; short enough
 * that a URL pasted somewhere is not a lasting grant.
 */

const FIFTEEN_MINUTES = 15 * 60 * 1000;

/**
 * The token, validated once at startup and held `Redacted`.
 *
 * The same treatment `DATABASE_URL` gets, for the same reason: a read-write
 * blob token is a credential, and a credential that can be `console.log`ged is
 * one that eventually is.
 */
const BlobToken = Config.redacted("BLOB_READ_WRITE_TOKEN");

const failing = (operation: string) => (cause: unknown) =>
  new StorageFailure({
    operation,
    detail: cause instanceof Error ? cause.message : String(cause),
  });

export const DocumentStoreLive = Layer.effect(
  DocumentStore,
  Effect.gen(function* () {
    const token = Redacted.value(yield* BlobToken);

    return DocumentStore.of({
      /**
       * `Buffer.from(body)` rather than the `Uint8Array` itself.
       *
       * The SDK's `PutBody` accepts a `Buffer`, a `Blob`, a `ReadableStream` or
       * a `File` — not a bare `Uint8Array`, which is what a Server Action gets
       * from `File.arrayBuffer()`. `Buffer.from` wraps the same memory rather
       * than copying it, and the interface stays on `Uint8Array` because that
       * is the platform-neutral type: a fake for the tests should not have to
       * know about Node's `Buffer`.
       */
      put: (key, body, contentType) =>
        Effect.tryPromise({
          try: () =>
            put(key, Buffer.from(body), {
              /**
               * `private`, and the store itself refuses anything else — a
               * private store rejects a `public` put outright rather than
               * quietly downgrading it. Which is the correct behaviour, and is
               * how the mistake here was caught: this said `public` until the
               * first real upload, because no unit test can hold an opinion
               * about a store it does not talk to.
               */
              access: "private",
              token,
              contentType,
              /**
               * `addRandomSuffix: false`, because the key is chosen by
               * `DocumentService` and encodes the matter, the document and the
               * version number. A random suffix would make the stored object
               * unfindable from the row that points at it, which is the one
               * property this mapping has to keep.
               */
              addRandomSuffix: false,
              /**
               * **Overwriting is not permitted**, which is the store's half of
               * "versions are append-only".
               *
               * The domain refuses to revise a filed document and Postgres
               * refuses a duplicate `(document_id, number)`; without this, the
               * bytes would still be replaceable underneath a version whose
               * row never changed — the row would say v2, 84 KB, uploaded on
               * the 12th, and the object behind it would be something else
               * entirely. That is the failure mode a version history exists to
               * rule out.
               *
               * `allowOverwrite` defaults to `false`, so this is the SDK's
               * behaviour rather than a setting. It is spelled out because a
               * caller who hits it — the seed script, re-importing — must
               * delete deliberately rather than reach for the flag.
               */
              allowOverwrite: false,
            }),
          catch: failing("put"),
        }).pipe(Effect.map(() => ({ sizeBytes: body.byteLength }))),

      signedUrl: (key) =>
        Effect.tryPromise({
          try: async () => {
            const validUntil = Date.now() + FIFTEEN_MINUTES;

            const signed = await issueSignedToken({
              token,
              pathname: key,
              // Reads only. A token that could also `put` would let whoever
              // holds a download link overwrite the document it points at.
              operations: ["get"],
              validUntil,
            });

            const { presignedUrl } = await presignUrl(signed, {
              operation: "get",
              pathname: key,
              access: "private",
              validUntil,
            });

            return presignedUrl;
          },
          catch: failing("signedUrl"),
        }),

      remove: (key) =>
        Effect.tryPromise({
          try: () => del(key, { token }),
          catch: failing("remove"),
        }).pipe(Effect.asVoid),
    });
  }),
);
