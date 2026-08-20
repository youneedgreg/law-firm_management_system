import { type Either, Effect, Option } from "effect";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Principal } from "../domain/identity/principal";
import { IdentityService } from "../services/identity-service";
import { CurrentUser } from "../services/policy";
import { type AppServices, run, runtime } from ".";

/**
 * The signed-in principal, for Server Components and Server Actions.
 *
 * This is the server half of Phase 6's central claim: **authorization is
 * checked in the data layer, on every read.** `proxy.ts` redirects a signed-out
 * browser away from `/cases` before the page renders, and that is a convenience
 * — it makes the common case fast and the URL bar honest. It is not the
 * control. The control is here, and in the services, and it applies whether the
 * request arrived through a page, a Server Action, the HTTP API, or anything
 * added later that nobody has thought of yet.
 *
 * Kept out of `runtime/index.ts` deliberately: this module imports
 * `next/headers`, which only resolves inside a request. `index.ts` is imported
 * by the API's web handler and by tests that build their own layers, and
 * neither has a request to read.
 */

/** Whoever is signed in, or nobody. */
export const principal = (): Promise<Option.Option<Principal>> =>
  headers().then((requestHeaders) =>
    run(
      Effect.flatMap(IdentityService, (identity) =>
        identity.identify(requestHeaders),
      ),
    ),
  );

/**
 * Whoever is signed in, or a redirect to the sign-in page.
 *
 * Exported because the two layouts call it directly: the shell needs the
 * principal to render, and a layout that redirected in a `useEffect` after the
 * page had already been sent would be a dashboard that flashes before it
 * disappears.
 *
 * A redirect rather than a thrown error because this is what a person meets
 * when their session expires mid-afternoon, and "Application error" is a poor
 * way to say "sign in again". `redirect` throws a value Next understands, so it
 * is deliberately raised *outside* the Effect — inside, it would be caught as a
 * defect by an error boundary and rendered instead of followed.
 */
export const signedIn = async (): Promise<Principal> => {
  const who = await principal();

  if (Option.isNone(who)) {
    redirect("/sign-in");
  }

  return who.value;
};

/**
 * Runs an effect as the signed-in principal.
 *
 * The `CurrentUser` requirement in the effect's type is what forces this call
 * site to exist: a page cannot read a matter without one, so a page cannot
 * accidentally read one as nobody. Failures reject into `error.tsx`, exactly as
 * `run` does — and a `NotPermitted` reaching that boundary means a screen
 * offered something the role may not do, which is a bug in the screen worth
 * seeing rather than a message worth polishing.
 */
export const runAs = async <A, E>(
  effect: Effect.Effect<A, E, AppServices | CurrentUser>,
): Promise<A> => {
  const who = await signedIn();
  return runtime.runPromise(Effect.provideService(effect, CurrentUser, who));
};

/**
 * Runs an effect as the signed-in principal, handing back its typed failure.
 *
 * The counterpart to `attempt` for Server Actions, and the same division: a
 * refusal the form should show comes back as a value, and a defect still
 * reaches the boundary.
 */
export const attemptAs = async <A, E>(
  effect: Effect.Effect<A, E, AppServices | CurrentUser>,
): Promise<Either.Either<A, E>> => {
  const who = await signedIn();
  return runtime.runPromise(
    Effect.either(Effect.provideService(effect, CurrentUser, who)),
  );
};
