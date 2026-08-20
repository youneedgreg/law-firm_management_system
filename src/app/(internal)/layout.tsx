import { redirect } from "next/navigation";
import { InternalShell } from "@/components/InternalShell";
import { permissionsOf } from "@/domain/identity/permissions";
import { signedIn } from "@/runtime/session";

// A route group adds no URL segment, so this layout sits at "/" alongside the
// root layout and nests inside it, wrapping every staff-facing route.
/**
 * The staff-facing shell, and the first of two real gates on the way in.
 *
 * `signedIn()` verifies the session against the database and redirects to
 * `/sign-in` if there is none — which is what `proxy.ts` also does, optimistically
 * and without checking anything. The duplication is the design: the proxy makes
 * the common case quick, and this makes it true.
 *
 * A portal user is sent to their own surface rather than shown a staff screen
 * they may not use. That is a redirect and not a refusal because it is not a
 * security decision — every one of those screens would refuse them anyway,
 * operation by operation, in `services/`. This just declines to render a
 * dashboard for somebody whose permissions would empty it.
 */
export default async function InternalLayout({ children }: LayoutProps<"/">) {
  const principal = await signedIn();

  if (principal._tag === "PortalUser") redirect("/portal");

  return (
    <InternalShell
      session={{ principal, permissions: permissionsOf(principal) }}
    >
      {children}
    </InternalShell>
  );
}
