import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";
import { permissionsOf } from "../../domain/identity/permissions";
import { CurrentUser } from "../../services/policy";
import { OkLawApi } from "../contract";

/**
 * The session group, implemented.
 *
 * One handler, and it needs no service at all: the middleware has already
 * resolved the principal, and what a principal may do is a pure function of the
 * permission table. Reaching `CurrentUser` directly here rather than through a
 * service is the exception that proves the rule — there is no application logic
 * to put in one.
 */
export const SessionHandlers = HttpApiBuilder.group(
  OkLawApi,
  "session",
  (handlers) =>
    handlers.handle("me", () =>
      Effect.map(CurrentUser, (principal) => ({
        principal,
        permissions: permissionsOf(principal),
      })),
    ),
);
