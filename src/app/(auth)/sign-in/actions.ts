"use server";

import { Effect, Either, Schema } from "effect";
import { Credentials } from "./forms";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { type ActionState, refused, typedValues } from "@/lib/action-state";
import { DEMO_PASSWORD, demoAccount } from "@/lib/demo";
import { sourceOf } from "@/lib/request-source";
import { attempt } from "@/runtime";
import { isDemoDeployment } from "@/runtime/deployment";
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
const destination = (
  next: FormDataEntryValue | null,
  fallback = "/dashboard",
): string => {
  const path = typeof next === "string" ? next : "";
  return path.startsWith("/") && !path.startsWith("//") ? path : fallback;
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

/**
 * One click, one role (D-5).
 *
 * ## It is the same sign-in, and that is the whole design
 *
 * The button posts a *key* — `finance-officer` — and the roster in `lib/demo.ts`
 * turns it into an address. It could have posted the address and the password
 * in hidden fields, since both are printed on the page a few centimetres above;
 * a key is better anyway, because it makes the set of accounts this endpoint
 * will sign in as a closed list in the source rather than whatever the form
 * happened to submit. An unknown key is refused, not attempted.
 *
 * From there it is `IdentityService.signInAsDemo`, which is
 * `signIn` with one more counter in front of it: the password is checked, the
 * attempt is audited, the session is issued by the same gateway. There is no
 * second door, no "demo mode" branch inside the services, and nothing here that
 * a real deployment would have to be trusted to remove — deleting the roster
 * deletes the feature.
 *
 * ## Where it lands
 *
 * `?next=` is honoured only when the account could actually use it. A signed-out
 * client following a bookmark to `/portal/invoices` should be returned there,
 * and the same client sent to `/cases` — because the proxy turned a *staff* URL
 * away before anybody chose a role — should not be bounced through a dashboard
 * they may not see. So a portal account follows `next` only into `/portal`, and
 * otherwise each account goes to its own landing.
 */
export async function signInAs(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  /**
   * First, and on the server (D-11).
   *
   * Not rendering the buttons is not a control. A Server Action is a POST
   * endpoint with a generated id, reachable by anything that has seen the id
   * once — from a bookmarked page, a cached bundle, a script — whether or not
   * this deployment currently renders a form that posts to it. So the check is
   * here, at the top, rather than being something the page is trusted to have
   * decided by not calling.
   *
   * Before `demoAccount`, and before `DEMO_PASSWORD` is read. On an
   * installation that is not the demonstration there is no roster to consult
   * and no shared password worth touching: the endpoint's answer does not
   * depend on what was submitted, so nothing submitted is examined.
   */
  if (!(await isDemoDeployment())) {
    return refused("Demo sign-in is not available on this deployment.");
  }

  const account = demoAccount(form.get("account"));

  if (account === undefined) {
    return refused("That demo account is not one of the seeded roles.");
  }

  const from = sourceOf(await headers());

  const outcome = await attempt(
    Effect.flatMap(IdentityService, (identity) =>
      identity.signInAsDemo(
        { email: account.email, password: DEMO_PASSWORD },
        from,
      ),
    ),
  );

  if (Either.isLeft(outcome)) {
    /**
     * `InvalidCredentials` here does not mean what it means on the form above.
     * Nobody typed anything: it means the database this deployment is pointed
     * at has not been seeded, or has been seeded with a different password. The
     * refusal says so, because "invalid email or password" would send a visitor
     * looking for a typo in a form they never filled in.
     */
    return refused(
      outcome.left._tag === "InvalidCredentials"
        ? "The demo accounts are not present in this database. Run npm run db:seed."
        : `${outcome.left.reason}.`,
    );
  }

  await write(outcome.right);

  const next = destination(form.get("next"), account.landing);
  redirect(
    account.landing === "/portal" && !next.startsWith("/portal")
      ? "/portal"
      : next,
  );
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
