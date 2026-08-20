import { render, type RenderResult } from "@testing-library/react";
import { vi } from "vitest";
import { SessionProvider } from "@/components/Session";
import { permissionsOf } from "@/domain/identity/permissions";
import type * as Identity from "@/domain/identity/principal";
import { RxRegistry } from "@/rx/provider";
import { type Firm, runningApi } from "./api-harness";
import { asPartner } from "./fixtures";

/**
 * A component, its atoms, and the real API underneath them.
 *
 * The atoms fetch through the client `HttpApiClient` derives from the contract,
 * over `fetch`. So the seam a component test needs is `fetch` itself — replace
 * it with the in-process handler and the whole path is real: React reads an
 * atom, the atom calls the generated client, the client encodes a request, the
 * *actual* router decodes it, the actual service answers, the response is
 * decoded back through the contract, and the component renders it. Only the
 * repositories are arrays.
 *
 * That is the same substitution `api-harness.ts` makes for the API tests, one
 * layer further out. Nothing is stubbed that anybody wrote: no mocked client,
 * no fake `Result`, no hand-written JSON. A test that stubbed the client would
 * pass while the encoding was wrong, which is the half most likely to be.
 *
 * The clock inside the handler is stopped at `TODAY` (see `api-harness.ts`), so
 * an invoice's "Overdue" and an advocate's practising certificate mean the same
 * thing in January as they do today.
 */

/**
 * The request the client built, as one the handler can be given.
 *
 * The `signal` is dropped, and it has to be. Effect creates an `AbortSignal`
 * from the environment's own class — jsdom's, here — and `Request` is Node's,
 * which checks the instance against undici's and refuses one from another
 * realm. Two implementations of the same standard in one process is a jsdom
 * artefact and not something the browser or the server ever sees; the cost is
 * that a test cannot cancel a request in flight, which none of these do.
 */
const asRequest = (input: RequestInfo | URL, init?: RequestInit): Request =>
  new Request(input as RequestInfo, { ...init, signal: null });

/** Points `fetch` at the API, built over the given fixtures. */
export const servedBy = (firm: Firm = {}): { dispose: () => Promise<void> } => {
  const api = runningApi(firm);

  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    api.handler(asRequest(input, init)),
  );

  return { dispose: api.dispose };
};

/**
 * Points `fetch` at an API that answers only when told to.
 *
 * For the assertions that are about the *interval* — that a status shows as
 * moved while the request is still out, that a table says it is reading before
 * it has anything to read. A test that awaited the response could not tell an
 * optimistic update from a slow one.
 */
export const servedSlowlyBy = (
  firm: Firm = {},
): { readonly answer: () => void; readonly dispose: () => Promise<void> } => {
  const api = runningApi(firm);
  let release = (): void => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = asRequest(input, init);
      await held;
      return api.handler(request);
    },
  );

  return { answer: () => release(), dispose: api.dispose };
};

/** Points `fetch` at nothing, the way a dropped connection does. */
export const unreachable = (): void => {
  vi.stubGlobal("fetch", () =>
    Promise.reject(new TypeError("Failed to fetch")),
  );
};

/**
 * Renders inside the registry *and* the session the application provides.
 *
 * Both are the real thing: `RxRegistry` is the provider the root layout
 * mounts, and `SessionProvider` is what the two shells wrap their children in
 * after the layout has resolved the principal on the server. A component that
 * reads `useSession` outside one throws, deliberately — so a test that forgets
 * this is a test that fails loudly rather than one that renders a screen as
 * nobody.
 */
export const renderWithAtoms = (
  ui: React.ReactElement,
  principal: Identity.Principal = asPartner,
): RenderResult =>
  render(
    <RxRegistry>
      <SessionProvider
        session={{ principal, permissions: permissionsOf(principal) }}
      >
        {ui}
      </SessionProvider>
    </RxRegistry>,
  );
