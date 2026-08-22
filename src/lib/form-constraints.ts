import { JSONSchema, type Schema } from "effect";

/**
 * The constraints a form's own schema already knows, as input attributes.
 *
 * Every create and edit form in this application decodes its `FormData`
 * through a schema on the server, and every one of them *also* restated some
 * of that schema by hand in JSX — a `required` here, nothing at all there.
 * Two descriptions of the same rule, and only one of them enforced, so the
 * copy in the markup could quietly stop being true and the only symptom would
 * be a round trip that did not need to happen.
 *
 * These are derived from the schema instead, so a constraint added to the
 * domain reaches the input in the same commit that adds it.
 *
 * ## Not a second validator
 *
 * The server still decides. This is only about not making somebody wait for a
 * refusal that could have been avoided, and the distinction decides what is
 * derived and what is not: **a constraint is worth deriving when the browser's
 * own message is no worse than the sentence the server would have sent.**
 *
 * - `required` — "Please fill in this field" is the whole of what the server
 *   would say, and saying it without a round trip is strictly better.
 * - `minLength` / `maxLength` — `maxLength` produces no message at all; it
 *   simply stops the typing. Nothing to be worse than.
 * - `pattern` — carried, and its message deliberately left generic. The
 *   browser says "Please match the requested format", and a `title` beside the
 *   pattern would be appended to that, which looked like the elegant answer
 *   until the candidates were read: the schemas here are annotated *"a
 *   Universally Unique Identifier"* and *"a non empty string"*, which say what
 *   the value **is** rather than what to type, and appending either makes the
 *   message worse than saying nothing. The one description that *is* an
 *   instruction — `KraPin`'s "A or P, nine digits, a checkletter" — is already
 *   on that field as a hint and a placeholder, permanently, which beats a
 *   bubble that appears once and only on a mistake.
 *
 *   What the pattern still earns without a message is the case it was there
 *   for: `NonEmptyTrimmedString` refuses a field containing only spaces, which
 *   `required` alone happily submits.
 *
 * ## What is deliberately not derived
 *
 * **Numeric bounds.** `claimValueShillings` is a `NumberFromString`, so its
 * "non-negative" refinement sits on the *decoded* side. The encoded schema —
 * the one describing what the input actually submits — is a string, and has no
 * `minimum` to read. Deriving `min` would mean interpreting the decoded side
 * and hoping the transform is monotonic, which is a guess.
 *
 * **Enumerations.** A `<select>`'s options are already written out where they
 * are rendered, and they need labels ("No matter — firm work") that a union of
 * literals does not carry. A schema can say which values are legal; it cannot
 * say what to call them.
 *
 * ## Where the constraints come from
 *
 * `JSONSchema.make` describes the **encoded** side, which is the side a form
 * submits — strings, in every case. That is what makes this work uniformly
 * across the plain `Schema.Struct` forms and the `Schema.transform` ones,
 * where the decoded type is a service argument that no input could hold.
 */

export interface FieldConstraints {
  readonly required?: boolean | undefined;
  readonly minLength?: number | undefined;
  readonly maxLength?: number | undefined;
  readonly pattern?: string | undefined;
}

interface Node {
  readonly $ref?: string;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
  readonly description?: string;
  readonly type?: string;
}

interface Document {
  readonly $defs?: Readonly<Record<string, Node>>;
  readonly required?: readonly string[];
  readonly properties?: Readonly<Record<string, Node>>;
}

/**
 * Effect's stand-in description for a `Schema.pattern` nobody annotated.
 *
 * It is the difference between a rule that can explain itself and one that
 * cannot, so it is the line this module draws: a pattern whose only
 * description restates the regular expression is **not** derived. Shown to
 * somebody it would read "Please match the requested format. a string matching
 * the pattern ^([01]\d|2[0-3]):[0-5]\d$", which is worse than saying nothing
 * and much worse than the sentence the server would have sent.
 *
 * In practice every one of them is on a field where HTML ignores `pattern`
 * anyway — a date, a time, or a `<select>` of ids — so nothing is given up.
 */
const UNEXPLAINED = /^a string matching the pattern /;

/** Follows `$ref` into `$defs`, which is where a named schema's rules live. */
function resolve(node: Node, defs: Readonly<Record<string, Node>>): Node {
  let current = node;
  for (let hop = 0; current.$ref !== undefined && hop < 10; hop += 1) {
    const name = current.$ref.split("/").pop();
    const next = name === undefined ? undefined : defs[name];
    if (next === undefined) return current;
    current = next;
  }
  return current;
}

/**
 * Reads a form schema once, at module scope, and answers per field.
 *
 * Once rather than per render because `JSONSchema.make` walks the whole AST,
 * and a form's schema is a constant.
 */
export function constraintsOf(
  schema: Schema.Schema.Any,
): (field: string) => FieldConstraints {
  const document = JSONSchema.make(schema) as Document;
  const defs = document.$defs ?? {};
  const required = new Set(document.required ?? []);
  const properties = document.properties ?? {};

  const known = new Map<string, FieldConstraints>();
  for (const [field, raw] of Object.entries(properties)) {
    const node = resolve(raw, defs);
    const explained =
      node.description !== undefined && !UNEXPLAINED.test(node.description);
    known.set(field, {
      required: required.has(field) ? true : undefined,
      minLength: node.minLength,
      maxLength: node.maxLength,
      pattern: explained ? node.pattern : undefined,
    });
  }

  return (field) => {
    const found = known.get(field);
    if (found === undefined) {
      // A name the schema has never heard of is a field whose value the
      // server will discard. Loud, because it is silent everywhere else: the
      // decode ignores unknown keys and the form looks like it works.
      throw new Error(`No such field on this form's schema: ${field}`);
    }
    return found;
  };
}
