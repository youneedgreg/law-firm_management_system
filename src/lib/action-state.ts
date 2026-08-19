/**
 * What a Server Action hands back to the form that called it.
 *
 * A refusal is a value here, not an exception. "This advocate holds no
 * practising certificate" and "that status move is not allowed" are answers the
 * form should show; only the genuinely unexpected belongs in an error boundary.
 *
 * Plain data on purpose. A Server Action's return value is serialised across
 * the network to the client, so anything with a prototype — an `Either`, a
 * tagged error class — arrives as something else or not at all. The action
 * converts at that edge.
 *
 * It lives in `lib/` rather than beside any one module's actions because the
 * dialog that renders it is shared, and a shared component that imported one
 * route's action file to get a type would tie every route to that one.
 */
export interface ActionState {
  readonly status: "idle" | "refused";
  /** One sentence, written for the person reading it. Empty while idle. */
  readonly reason: string;
  /** Per-field messages from schema decoding, keyed by the input's `name`. */
  readonly fields: Readonly<Record<string, string>>;
  /**
   * What was submitted, so a refused form can be shown again as it was typed.
   *
   * React resets an uncontrolled `<form action={…}>` once the action returns —
   * which is right after a successful submit and destructive after a refused
   * one, because the eight fields that were fine are cleared along with the one
   * that was not. Sending the values back is what lets `defaultValue` put them
   * where they were.
   *
   * Every entry is carried, blanks included. A field the user deliberately
   * cleared must come back cleared, and dropping empties would quietly restore
   * the old value instead.
   */
  readonly values: Readonly<Record<string, string>>;
}

export const IDLE: ActionState = {
  status: "idle",
  reason: "",
  fields: {},
  values: {},
};

export const refused = (
  reason: string,
  options: {
    readonly fields?: Readonly<Record<string, string>>;
    readonly values?: Readonly<Record<string, string>>;
  } = {},
): ActionState => ({
  status: "refused",
  reason,
  fields: options.fields ?? {},
  values: options.values ?? {},
});

/**
 * Every value in a submission, blanks included.
 *
 * Distinct from the decoding pass, which drops blanks so that an untouched
 * optional field reads as absent rather than as the empty string. This one is
 * for putting the form back the way it was.
 */
export const typedValues = (
  form: FormData,
): Readonly<Record<string, string>> => {
  const values: Record<string, string> = {};
  for (const [name, value] of form.entries()) {
    if (typeof value === "string") values[name] = value;
  }
  return values;
};
