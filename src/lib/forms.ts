/**
 * Reading a submitted form. Every create form in the app collects its values
 * out of `FormData`, so the conversions from raw entries to domain values live
 * here once rather than in each screen.
 */

/** A trimmed text field. */
export function text(fields: FormData, name: string): string {
  const value = fields.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** A numeric field; blank or unparsable input reads as `fallback`. */
export function number(fields: FormData, name: string, fallback = 0): number {
  const parsed = Number.parseFloat(text(fields, name));
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** A checkbox group — every ticked value under one name. */
export function list(fields: FormData, name: string): string[] {
  return fields
    .getAll(name)
    .filter((value): value is string => typeof value === "string");
}

/** A single checkbox: present in the submission only when ticked. */
export function checked(fields: FormData, name: string): boolean {
  return fields.get(name) !== null;
}

/** A comma-separated field, e.g. document tags. */
export function tags(fields: FormData, name: string): string[] {
  return text(fields, name)
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/** The id a newly created record takes, one past the highest already in use. */
export function nextId(existing: readonly { id: number }[]): number {
  return (
    existing.reduce((highest, record) => Math.max(highest, record.id), 0) + 1
  );
}
