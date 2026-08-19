import { createHash } from "node:crypto";

/**
 * Deterministic ids for the seeded records.
 *
 * The prototype keys everything on small integers and the domain keys on
 * UUIDs, so the import has to mint one per record. Minting them *randomly*
 * would make the seed unrepeatable: a second run would insert a parallel copy
 * of every row rather than updating the first, and no import could ever be
 * described as idempotent.
 *
 * So ids are derived — a UUID v5 over a fixed namespace, exactly as RFC 9562
 * defines it. `stableId("client", 4)` is the same uuid on every machine and in
 * every run, which is what lets the repositories' upserts do their job and
 * makes `npm run db:seed` safe to run twice.
 *
 * v5 (SHA-1) rather than v8: it is the standard name-based scheme, and the
 * hash is doing naming here, not security.
 */

/** A random uuid, fixed here forever. Changing it renames every seeded row. */
const NAMESPACE = "6f9f3b1e-3c2a-4f6d-8b5e-1a2c4d6e8f01";

const hyphenless = (uuid: string) => uuid.replace(/-/g, "");

export const stableId = (kind: string, key: string | number): string => {
  const hash = createHash("sha1")
    .update(Buffer.from(hyphenless(NAMESPACE), "hex"))
    .update(`${kind}:${key}`, "utf8")
    .digest();

  // Version 5 in the high nibble of byte 6, RFC 9562 variant in byte 8.
  const bytes = Uint8Array.prototype.slice.call(hash, 0, 16);
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;

  const hex = Buffer.from(bytes).toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
};
