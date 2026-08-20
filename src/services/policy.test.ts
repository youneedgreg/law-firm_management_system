import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  asPartner,
  asReceptionist,
  asWanjiku,
  wanjiku,
  zenith,
} from "../../test/fixtures";
import type { Principal } from "../domain/identity/principal";
import {
  CurrentUser,
  NotAuthenticated,
  permitted,
  withinScope,
} from "./policy";

/**
 * The two checks every operation makes, in isolation.
 *
 * `case-service.test.ts` covers them where they are used; this covers the
 * distinction between them, which is the part that is easy to state and easy to
 * get wrong: **permission says which verbs, scope says over which rows, and
 * they refuse differently on purpose.**
 */

const as = <A, E>(
  principal: Principal,
  body: Effect.Effect<A, E, CurrentUser>,
) => Effect.provideService(body, CurrentUser, principal);

describe("permission", () => {
  it.effect("hands back the principal that holds it", () =>
    as(
      asPartner,
      Effect.gen(function* () {
        expect(yield* permitted("case:open")).toBe(asPartner);
      }),
    ),
  );

  it.effect("refuses with the role and the permission", () =>
    as(
      asWanjiku,
      Effect.gen(function* () {
        const refused = yield* Effect.flip(permitted("case:open"));

        expect(refused._tag).toBe("NotPermitted");
        expect(refused.permission).toBe("case:open");
      }),
    ),
  );
});

describe("scope", () => {
  it.effect("passes a record belonging to the caller", () =>
    as(asWanjiku, withinScope("case", "any", wanjiku.id)),
  );

  /**
   * The refusal is `NotFound`, and that is the decision worth the test.
   *
   * A truthful "not yours" is an oracle: it confirms the record exists, and
   * with it that the firm acts for whoever owns it. The check therefore returns
   * the same error a missing record does, carrying the entity and the id it was
   * asked for and nothing about why.
   */
  it.effect("refuses another client's record as absent, not as forbidden", () =>
    as(
      asWanjiku,
      Effect.gen(function* () {
        const refused = yield* Effect.flip(
          withinScope("case", "a-matter-id", zenith.id),
        );

        expect(refused._tag).toBe("NotFound");
        expect(refused.entity).toBe("case");
        expect(refused.id).toBe("a-matter-id");
        expect(refused.reason).not.toContain("permission");
      }),
    ),
  );

  it.effect("lets staff see any client's record", () =>
    as(asPartner, withinScope("case", "any", zenith.id)),
  );
});

describe("being signed out", () => {
  /**
   * There is no test that an unauthenticated caller is refused, because there
   * is no way to write one: `CurrentUser` is in the `R` channel, so an effect
   * that checks a permission cannot be run without a principal. This asserts
   * the error's own shape instead — the thing a 401 body is built from.
   */
  it("says what to do rather than what went wrong", () => {
    expect(new NotAuthenticated().reason).toBe("Sign in to continue");
  });

  it.effect("is a different refusal from a permission being absent", () =>
    as(
      asReceptionist,
      Effect.gen(function* () {
        const refused = yield* Effect.flip(permitted("audit:read"));

        // 403, not 401: signing in again changes nothing.
        expect(refused._tag).toBe("NotPermitted");
        expect(refused._tag).not.toBe("NotAuthenticated");
      }),
    ),
  );
});
