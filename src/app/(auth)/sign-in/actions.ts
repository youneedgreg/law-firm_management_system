"use server";

import { Effect, Either, Schema } from "effect";
import { Credentials } from "./forms";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { type ActionState, refused, typedValues } from "@/lib/action-state";
import { sourceOf } from "@/lib/request-source";
import { attempt } from "@/runtime";
import { IdentityService } from "@/services/identity-service";
import type { SessionCookie } from "@/services/repositories";

/**
 * Signing in, and out.
 *
 * Server Actions rather than a `fetch` to Better Auth's HTTP endpoint from a
 * client component, for three reasons that all point the same way:
 *
 * 1. **The form works without JavaScript.** A `<form action={…}>` submits on
 *    its own, which is the same standard the intake form in Phase 3 was held
 *    to.
 * 2. **The refusal is a typed value.** `InvalidCredentials` comes back through
 *    `attempt` and is rendered beside the fields by the same `ActionState`
 *    machinery every other form uses — no second error convention for the one
 *    form everybody meets first.
 * 3. **There is one door.** `IdentityService.signIn` is where the audit entry
 *    is written, and the HTTP route refuses `/sign-in/email` precisely so that
 *    this cannot be gone around.
 *
 * The cookies come back as values and are written here. That division is
 * deliberate: `services/` decides that a session exists, and this — the layer
 * that has a response — decides how it is carried.
 */

/**
 * Where to go after signing in.
 *
 * Validated as a *relative* path before it is used. `?next=` is set by the
 * proxy when it turns an unauthenticated request away, and an unchecked
 * redirect target is an open redirect: `/sign-in?next=https://evil.example`
 * would send somebody who just typed their password to somebody else's site,
 * from a link that looks like ours.
 */
const destination = (next: FormDataEntryValue | null): string => {
  const path = typeof next === "string" ? next : "";
  return path.startsWith("/") && !path.startsWith("//") ? path : "/dashboard";
};

const write = async (jar: readonly SessionCookie[]): Promise<void> => {
  const store = await cookies();
  for (const cookie of jar) {
    store.set(cookie.name, cookie.value, cookie.options);
  }
};

export async function signIn(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const values = typedValues(form);

  const credentials = Schema.decodeUnknownEither(Credentials)({
    email: form.get("email"),
    password: form.get("password"),
  });

  if (Either.isLeft(credentials)) {
    return refused("Enter your email address and your password.", {
      // The password is deliberately not carried back. Everything else on a
      // refused form is restored; a password field that refills itself is a
      // password sitting in a page that may be left open.
      values: { email: values["email"] ?? "" },
    });
  }

  /**
   * The connection this attempt came from, which is what the rate limit is
   * keyed on. Read here rather than inside the service because `next/headers`
   * only resolves inside a request, and `services/` must stay runnable without
   * one.
   */
  const from = sourceOf(await headers());

  const outcome = await attempt(
    Effect.flatMap(IdentityService, (identity) =>
      identity.signIn(credentials.right, from),
    ),
  );

  if (Either.isLeft(outcome)) {
    return refused(`${outcome.left.reason}.`, {
      values: { email: credentials.right.email },
    });
  }

  await write(outcome.right);

  // Outside the `attempt` above: `redirect` throws a control-flow value for
  // Next to catch, and thrown inside an Effect it would be caught as a defect.
  redirect(destination(form.get("next")));
}

export async function signOut(): Promise<void> {
  const store = await cookies();

  const jar = await attempt(
    Effect.flatMap(IdentityService, (identity) =>
      identity.signOut(new Headers({ cookie: store.toString() })),
    ),
  );

  if (Either.isRight(jar)) await write(jar.right);

  redirect("/sign-in");
}
