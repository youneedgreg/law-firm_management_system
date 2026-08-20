import { redirect } from "next/navigation";
import { PortalShell } from "@/components/PortalShell";
import { permissionsOf } from "@/domain/identity/permissions";
import { signedIn } from "@/runtime/session";

/**
 * The client portal's shell.
 *
 * The mirror of the internal layout: a member of staff who lands here is sent
 * to the dashboard, because the portal is a client's view of their own file
 * rather than a read-only mode of the application. Staff who want to see what a
 * client sees have the client's own matter file, which shows more.
 *
 * Everything past this point is scoped by `Scope` in `services/`, not by this
 * layout. A portal user asking for another client's matter gets `NotFound` from
 * `CaseService` whether they arrived through a page, the API, or a URL they
 * guessed.
 */
export default async function PortalLayout({
  children,
}: LayoutProps<"/portal">) {
  const principal = await signedIn();

  if (principal._tag === "Staff") redirect("/dashboard");

  return (
    <PortalShell session={{ principal, permissions: permissionsOf(principal) }}>
      {children}
    </PortalShell>
  );
}
