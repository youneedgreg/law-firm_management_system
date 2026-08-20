"use client";

import { createContext, useContext } from "react";
import type { Permission } from "@/domain/identity/permissions";
import type { Principal } from "@/domain/identity/principal";

/**
 * Who is signed in, for the components that need to know.
 *
 * A React context rather than an atom, and the reason is worth stating because
 * Phase 5 spent an ADR arguing the other way for server *data*. Identity is not
 * server data in that sense: it does not change while the page is open, it
 * cannot be refetched into something different, and it is already known before
 * the first byte is rendered — the layout is a Server Component and reads it
 * in-process. Fetching it again from the browser would mean a request per page
 * load, and a moment of every screen rendered as nobody.
 *
 * This replaces `roleRx`, the browser-held role from the prototype's switcher.
 * That atom let a person choose their own role, which was exactly right for a
 * wireframe and is exactly wrong now: the role comes from the session, the
 * session comes from a cookie the server signed, and no screen may pick.
 *
 * **These values decide what to offer, never what is allowed.** The server
 * checks the same permission again on every read and every write, because a
 * context in a browser is a suggestion.
 */

export interface Session {
  readonly principal: Principal;
  readonly permissions: readonly Permission[];
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({
  session,
  children,
}: {
  session: Session;
  children: React.ReactNode;
}) {
  return <SessionContext value={session}>{children}</SessionContext>;
}

/**
 * Throws when there is no provider, rather than returning null.
 *
 * Every screen that calls this is inside a layout that requires a session, so
 * "no session" is not a state to render — it is a component mounted somewhere
 * it does not belong, and a loud failure in development is the fastest way to
 * find out.
 */
export function useSession(): Session {
  const session = useContext(SessionContext);

  if (session === null) {
    throw new Error(
      "useSession outside a SessionProvider: this component is rendered " +
        "outside the signed-in shell",
    );
  }

  return session;
}

/** Whether the signed-in principal holds a permission. */
export function useMay(permission: Permission): boolean {
  return useSession().permissions.includes(permission);
}
