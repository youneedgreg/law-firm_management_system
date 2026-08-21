import { SqlClient } from "@effect/sql";
import { Effect, Layer, Option, Schema } from "effect";
import type * as Documents from "../../domain/document/document";
import type { CaseId, DocumentId } from "../../domain/shared/ids";
import {
  DocumentRepository,
  NotFound,
  type RepositoryFailure,
  VersionAlreadyExists,
} from "../../services/repositories";
import { DocumentFromRow } from "./document-model";
import { failure, isUniqueViolation } from "./failure";
import { guarded, reading, writing } from "./resilience";

/**
 * Documents, in Postgres — an aggregate across two tables.
 *
 * `addVersion` is the operation worth reading. It is an append with the version
 * number computed inside the transaction, and the `(document_id, number)`
 * primary key is what makes the claim atomic: two uploads racing both compute
 * version 4, the second is refused, and the service retries onto 5. A
 * read-modify-write of the whole version list would silently drop one of them —
 * and the version that disappeared could be the one that was filed.
 */

type RawRow = Readonly<Record<string, unknown>>;

const byParent = (rows: readonly RawRow[], key: string) => {
  const grouped = new Map<string, RawRow[]>();
  for (const row of rows) {
    const parent = String(row[key]);
    const existing = grouped.get(parent);
    if (existing === undefined) grouped.set(parent, [row]);
    else existing.push(row);
  }
  return grouped;
};

export const DocumentRepositoryLive = Layer.effect(
  DocumentRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const decode = Schema.decodeUnknown(DocumentFromRow);

    const assemble = (rows: readonly RawRow[]) =>
      (rows.length === 0
        ? Effect.succeed([] as readonly RawRow[])
        : sql<RawRow>`
            SELECT * FROM document_versions
             WHERE document_id IN ${sql.in(rows.map((row) => String(row["id"])))}
             ORDER BY document_id, number
          `
      ).pipe(
        Effect.flatMap((versions) => {
          const grouped = byParent(versions, "documentId");
          return Effect.forEach(rows, (document) =>
            decode({
              document,
              versions: grouped.get(String(document["id"])) ?? [],
            }),
          );
        }),
      );

    return DocumentRepository.of({
      byId: (id: DocumentId) =>
        sql<RawRow>`SELECT * FROM documents WHERE id = ${id}`.pipe(
          Effect.flatMap(assemble),
          reading("DocumentRepository.byId"),
          Effect.flatMap((documents) =>
            Option.match(Option.fromNullable(documents[0]), {
              onNone: () =>
                Effect.fail(new NotFound({ entity: "Document", id })),
              onSome: Effect.succeed<Documents.Document>,
            }),
          ),
        ),

      forCase: (caseId: CaseId) =>
        sql<RawRow>`
          SELECT * FROM documents WHERE case_id = ${caseId} ORDER BY name
        `.pipe(Effect.flatMap(assemble), reading("DocumentRepository.forCase")),

      all: () =>
        sql<RawRow>`SELECT * FROM documents ORDER BY created_at DESC`.pipe(
          Effect.flatMap(assemble),
          reading("DocumentRepository.all"),
        ),

      /**
       * Upsert the document and replace its versions.
       *
       * Used only when the document is created, where "replace" and "insert"
       * are the same thing. Adding a version afterwards goes through
       * `addVersion`, which appends — see the note at the top of this file for
       * why that distinction is not cosmetic.
       */
      save: (document) =>
        Schema.encode(DocumentFromRow)(document).pipe(
          Effect.flatMap(({ document: row, versions }) =>
            sql.withTransaction(
              Effect.gen(function* () {
                yield* sql`
                  INSERT INTO documents ${sql.insert(row)}
                  ON CONFLICT (id) DO UPDATE SET ${sql.update(row, ["id"])}
                `;

                if (versions.length > 0) {
                  yield* sql`
                    INSERT INTO document_versions ${sql.insert(versions)}
                    ON CONFLICT (document_id, number) DO NOTHING
                  `;
                }
              }),
            ),
          ),
          Effect.as(document),
          writing("DocumentRepository.save"),
        ) satisfies Effect.Effect<Documents.Document, RepositoryFailure>,

      addVersion: (id, version) =>
        sql
          .withTransaction(
            Effect.gen(function* () {
              const document = yield* sql<{ readonly id: string }>`
                SELECT id FROM documents WHERE id = ${id}
              `;

              if (document.length === 0) {
                return yield* Effect.fail(
                  new NotFound({ entity: "Document", id }),
                );
              }

              yield* sql`
                INSERT INTO document_versions ${sql.insert({
                  documentId: id,
                  number: version.number,
                  storageKey: version.storageKey,
                  sizeBytes: version.sizeBytes,
                  uploadedBy: version.uploadedBy,
                  uploadedOn: version.uploadedOn,
                })}
              `;
            }),
          )
          .pipe(
            guarded("DocumentRepository.addVersion", { replayable: false }),
            Effect.catchTag(
              "SqlError",
              (
                error,
              ): Effect.Effect<
                never,
                VersionAlreadyExists | RepositoryFailure
              > =>
                isUniqueViolation(error, "document_versions_pkey")
                  ? Effect.fail(
                      new VersionAlreadyExists({ number: version.number }),
                    )
                  : Effect.fail(
                      failure("DocumentRepository.addVersion")(error),
                    ),
            ),
            Effect.asVoid,
          ),
    });
  }),
);
