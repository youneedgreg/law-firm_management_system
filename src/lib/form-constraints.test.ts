import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { constraintsOf } from "./form-constraints";

/**
 * The constraints a form shows, and the schema that actually enforces them.
 *
 * Two halves. The first is about the derivation itself — what is read out of a
 * schema and, as importantly, what is left alone. The second is the drift
 * guard: a form that derives *some* of its constraints and hand-writes the
 * rest is the arrangement this module exists to end, and it is the state a
 * half-finished migration leaves behind.
 */

describe("reading a schema", () => {
  it("takes `required` from the schema's own required list", () => {
    const field = constraintsOf(
      Schema.Struct({
        given: Schema.String,
        maybe: Schema.optional(Schema.String),
      }),
    );

    expect(field("given").required).toBe(true);
    expect(field("maybe").required).toBeUndefined();
  });

  it("takes the lengths", () => {
    const field = constraintsOf(
      Schema.Struct({
        reference: Schema.String.pipe(
          Schema.minLength(3),
          Schema.maxLength(12),
        ),
      }),
    );

    expect(field("reference").minLength).toBe(3);
    expect(field("reference").maxLength).toBe(12);
  });

  it("carries a pattern that came with a description", () => {
    // The KRA PIN is the live example: annotated, so its rule can be stated.
    const field = constraintsOf(
      Schema.Struct({
        pin: Schema.String.pipe(Schema.pattern(/^[AP]\d{9}[A-Z]$/)).annotations(
          { description: "A or P, nine digits, a checkletter" },
        ),
      }),
    );

    expect(field("pin").pattern).toBe("^[AP]\\d{9}[A-Z]$");
  });

  it("drops a pattern whose only description restates the regex", () => {
    // Effect writes "a string matching the pattern …" when nobody annotated
    // one. Put in front of somebody it reads "Please match the requested
    // format. a string matching the pattern ^\d{4}-\d{2}-\d{2}$", which is
    // worse than the browser's message alone.
    const field = constraintsOf(
      Schema.Struct({ day: Schema.String.pipe(Schema.pattern(/^\d{4}$/)) }),
    );

    expect(field("day").pattern).toBeUndefined();
  });

  it("reads the encoded side, which is what a form submits", () => {
    // The reason this works on the `Schema.transform` forms as well as the
    // plain structs: their decoded type is a service argument no input could
    // hold, and their encoded type is the strings the browser sends.
    const field = constraintsOf(
      Schema.transform(
        Schema.Struct({ amount: Schema.NonEmptyTrimmedString }),
        Schema.Struct({ cents: Schema.Number }),
        {
          strict: true,
          decode: ({ amount }) => ({ cents: Number(amount) * 100 }),
          encode: ({ cents }) => ({ amount: String(cents / 100) }),
        },
      ),
    );

    expect(field("amount").required).toBe(true);
  });

  it("refuses a field the schema has never heard of", () => {
    // Silent everywhere else: the decode ignores unknown keys, so a mistyped
    // `name` submits a value the server discards and the form looks fine.
    const field = constraintsOf(Schema.Struct({ title: Schema.String }));

    expect(() => field("titel")).toThrow(/No such field/);
  });
});

describe("no form is half-migrated", () => {
  function components(from: string): readonly string[] {
    return readdirSync(from, { withFileTypes: true }).flatMap((entry) => {
      const path = join(from, entry.name);
      if (entry.isDirectory()) return components(path);
      return entry.name.endsWith(".tsx") && !entry.name.includes(".test.")
        ? [path]
        : [];
    });
  }

  it("leaves no bare `required` in a form that derives its constraints", () => {
    // A form with a mix of derived and hand-written rules is worse than one
    // with neither, because the hand-written half now looks maintained.
    //
    // A `required` that is genuinely not derivable — the bytes of a file
    // upload, a field on a form that never reaches a Server Action — carries
    // a comment saying so, and this test reads the line above to find it.
    const offenders: string[] = [];
    for (const file of components(join(process.cwd(), "src/app"))) {
      const source = readFileSync(file, "utf8");
      if (!source.includes("constraintsOf")) continue;
      const lines = source.split("\n");
      lines.forEach((line, index) => {
        if (!/^\s*required\s*$/.test(line)) return;
        const above = lines[index - 1] ?? "";
        if (above.trim().startsWith("*") || above.trim().startsWith("/*"))
          return;
        offenders.push(
          `${file.split("src/app/")[1] ?? file}:${String(index + 1)}`,
        );
      });
    }

    expect(offenders).toEqual([]);
  });
});
