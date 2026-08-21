import { Option, Schema } from "effect";
import { AdvocateId, CaseId } from "@/domain/shared/ids";
import * as Work from "@/domain/work/task";
import type { RaiseTask } from "@/services/task-service";

/**
 * The boundary between the task form and the service.
 *
 * ## The empty string means "no matter"
 *
 * A `<select>` cannot submit an absent value — an unselected option submits the
 * empty string, and a selected "No matter" option has to submit *something*.
 * The domain's `caseId` is an `Option`, so the conversion happens here, once,
 * and is the whole reason this file exists.
 *
 * The sentinel is `""` rather than a word like `"none"`, because `""` is what
 * the browser already sends for "nothing chosen" — inventing a second way to
 * say the same thing would mean handling both.
 *
 * ## What is deliberately not on the form
 *
 * `status` was on the prototype's form and is gone. A task starts `Not started`
 * and reaches `Done` only through completing it, which is what keeps the status
 * and the completion record from disagreeing; a dropdown offering `Done` would
 * let somebody set it with nobody's name against it, which the domain and
 * Postgres both refuse anyway. Better to not ask than to ask and refuse.
 */

export const submitted = (form: FormData): Record<string, string> => {
  const fields: Record<string, string> = {};
  for (const [name, value] of form.entries()) {
    if (typeof value === "string" && value.trim() !== "") {
      fields[name] = value;
    }
  }
  return fields;
};

/** `"2026-08-26"` as midnight UTC, not local midnight. */
const DayInput = Schema.transform(
  Schema.String.pipe(Schema.pattern(/^\d{4}-\d{2}-\d{2}$/)),
  Schema.DateFromSelf,
  {
    strict: true,
    decode: (day) => new Date(`${day}T00:00:00.000Z`),
    encode: (date) => date.toISOString().slice(0, 10),
  },
).annotations({ identifier: "DayInput" });

export const RaiseTaskForm = Schema.Struct({
  title: Schema.NonEmptyTrimmedString,
  /**
   * Absent when the select submitted nothing, which `submitted` strips. Firm
   * work is the *default* reading of "no matter chosen" rather than an error,
   * because the form offers it explicitly.
   */
  caseId: Schema.optional(CaseId),
  assignedTo: AdvocateId,
  priority: Work.Priority,
  dueOn: DayInput,
});

export type RaiseTaskForm = typeof RaiseTaskForm.Type;

export const asRaiseTask = (form: RaiseTaskForm): RaiseTask => ({
  title: form.title,
  caseId: Option.fromNullable(form.caseId),
  assignedTo: form.assignedTo,
  priority: form.priority,
  dueOn: form.dueOn,
});

/** The value the "no matter" option submits. See the note above. */
export const NO_MATTER = "";
