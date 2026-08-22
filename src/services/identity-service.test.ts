import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Ref } from "effect";
import { asPartner } from "../../test/fixtures";
import {
  inMemoryAudit,
  inMemoryLimiter,
  inMemoryUsers,
} from "../../test/in-memory-repositories";
import * as Throttle from "../domain/identity/throttle";
import { AuditLog } from "./audit-service";
import { IdentityService } from "./identity-service";
import {
  InvalidCredentials,
  type SessionCookie,
  SessionGateway,
} from "./repositories";

/**
 * Signing in, and the limit that stands in front of it.
 *
 * The claims that matter are about *ordering* and *isolation*, and both are
 * invisible from the outside if they are wrong:
 *
 * - The limit is consulted **before** the password is checked. A limiter that
 *   ran afterwards would still refuse, and would refuse having already done the
 *   expensive hash — so an attacker would get the work done for free and the
 *   control would be decorative.
 * - Two connections cannot exhaust each other. This is the property that keeps
 *   the limiter from being a way to lock an advocate out of their own files,
 *   and it is the one a well-meaning "also limit per account" change removes.
 */

const SOURCE = "203.0.113.7";
const ELSEWHERE = "198.51.100.4";

const RIGHT = { email: asPartner.email, password: "correct horse" };
const WRONG = { email: asPartner.email, password: "hunter2" };

const COOKIE: SessionCookie = {
  name: "oklaw.session_token",
  value: "a-session",
  options: { httpOnly: true },
};

/**
 * Better Auth, reduced to the only thing this service asks of it: does this
 * password match, and how many times was I asked.
 *
 * The count is what proves the ordering. A sign-in refused by the limiter must
 * never reach the gateway at all.
 */
const gateway = () => {
  const asked = { times: 0 };

  return {
    asked,
    layer: Layer.succeed(
      SessionGateway,
      SessionGateway.of({
        identify: () => Effect.succeedNone,

        /**
         * `Effect.suspend`, and the first version of this fake did not have it
         * — which made this whole file green while proving nothing.
         *
         * An `Effect` is a value: building one runs no code. The counter has to
         * be incremented *inside* the effect, or it counts pipelines that were
         * assembled rather than calls that were made, and every throttled
         * attempt is scored as an ask. The real gateway is lazy for the same
         * reason without trying: `Effect.tryPromise` does not start its promise
         * until it is run.
         */
        signIn: ({ password }) =>
          Effect.suspend(() => {
            asked.times += 1;
            return password === RIGHT.password
              ? Effect.succeed({ userId: asPartner.userId, cookies: [COOKIE] })
              : Effect.fail(new InvalidCredentials());
          }),
        signOut: () => Effect.succeed([]),
        handle: () => Effect.succeed(new Response(null, { status: 200 })),
      }),
    ),
  };
};

const firm = () => {
  const sessions = gateway();
  const limiter = inMemoryLimiter();
  const audit = inMemoryAudit();

  return {
    asked: sessions.asked,
    recorded: audit.recorded,
    counters: limiter.store,
    layer: IdentityService.Default.pipe(
      Layer.provide(AuditLog.Default),
      Layer.provide(
        Layer.mergeAll(
          sessions.layer,
          limiter.layer,
          audit.layer,
          inMemoryUsers([asPartner]),
        ),
      ),
    ),
  };
};

/** One wrong password, `times` times, from one connection. */
const guess = (times: number, from = SOURCE) =>
  Effect.flatMap(IdentityService, (identity) =>
    Effect.forEach(Array.from({ length: times }), () =>
      Effect.either(identity.signIn(WRONG, from)),
    ),
  );

describe("the limit in front of the password check", () => {
  it.effect("lets the allowance through and refuses the next one", () => {
    const app = firm();

    return Effect.gen(function* () {
      const [account] = Throttle.forSignIn(SOURCE, WRONG.email);
      const allowed = account?.attempts ?? 0;

      const outcomes = yield* guess(allowed + 1);

      /** Every attempt up to the allowance is a credentials failure… */
      for (const outcome of outcomes.slice(0, allowed)) {
        expect(outcome._tag === "Left" ? outcome.left._tag : "ok").toBe(
          "InvalidCredentials",
        );
      }

      /** …and the one after it never gets that far. */
      const last = outcomes[allowed];
      expect(last?._tag === "Left" ? last.left._tag : "ok").toBe(
        "TooManyAttempts",
      );
    }).pipe(Effect.provide(app.layer));
  });

  /**
   * The assertion the whole design turns on. Password hashing is deliberately
   * expensive; a limiter consulted afterwards makes an attacker's guesses cost
   * the *server* and cost them nothing.
   */
  it.effect("never asks Better Auth once the allowance is spent", () => {
    const app = firm();

    return Effect.gen(function* () {
      const [account] = Throttle.forSignIn(SOURCE, WRONG.email);
      const allowed = account?.attempts ?? 0;

      yield* guess(allowed + 4);

      expect(app.asked.times).toBe(allowed);
    }).pipe(Effect.provide(app.layer));
  });

  /**
   * A refused sign-in and a throttled one are different events, and the trail
   * has to say which — otherwise an incident review cannot tell whether the
   * control fired at all.
   */
  it.effect("records the throttling as its own audit action", () => {
    const app = firm();

    return Effect.gen(function* () {
      const [account] = Throttle.forSignIn(SOURCE, WRONG.email);
      yield* guess((account?.attempts ?? 0) + 1);

      /** Newest first, which is how the compliance screen reads them. */
      const recorded = yield* app.recorded;
      const actions = recorded.map((entry) => entry.action);

      expect(actions).toContain("session.refused");
      expect(actions).toContain("session.throttled");
      expect(actions[0]).toBe("session.throttled");
    }).pipe(Effect.provide(app.layer));
  });
});

describe("what one connection cannot do to another", () => {
  /**
   * Every advocate's address is on the firm's website. If exhausting the
   * counter from one connection refused the next from a different one, anybody
   * who could read that page could lock a partner out on the morning of a
   * hearing.
   */
  it.effect("cannot spend another connection's attempts", () => {
    const app = firm();

    return Effect.gen(function* () {
      const [account] = Throttle.forSignIn(SOURCE, WRONG.email);
      yield* guess((account?.attempts ?? 0) + 3);

      const fromTheOffice = yield* Effect.flatMap(IdentityService, (identity) =>
        Effect.either(identity.signIn(RIGHT, ELSEWHERE)),
      );

      expect(fromTheOffice._tag).toBe("Right");
    }).pipe(Effect.provide(app.layer));
  });

  /**
   * The wider bucket is what stops a host trying one or two passwords against
   * every address in turn — which is what a stuffing list actually looks like,
   * and which the narrow bucket alone would never notice.
   */
  it.effect("still stops one connection working through many accounts", () => {
    const app = firm();

    return Effect.gen(function* () {
      const [, source] = Throttle.forSignIn(SOURCE, WRONG.email);
      const allowed = source?.attempts ?? 0;

      const outcomes = yield* Effect.flatMap(IdentityService, (identity) =>
        Effect.forEach(Array.from({ length: allowed + 1 }), (_, index) =>
          Effect.either(
            identity.signIn(
              { email: `person${index}@oklaw.co.ke`, password: "guess" },
              SOURCE,
            ),
          ),
        ),
      );

      const last = outcomes[allowed];
      expect(last?._tag === "Left" ? last.left._tag : "ok").toBe(
        "TooManyAttempts",
      );
    }).pipe(Effect.provide(app.layer));
  });
});

describe("a successful sign-in", () => {
  /**
   * Without this, somebody who mistypes their password four times and then gets
   * it right carries those four attempts for the rest of the window, and is
   * refused on their next visit for something already resolved.
   */
  it.effect("forgets the attempts that led up to it", () => {
    const app = firm();

    return Effect.gen(function* () {
      yield* guess(4);
      yield* Effect.flatMap(IdentityService, (identity) =>
        identity.signIn(RIGHT, SOURCE),
      );

      const counters = yield* Ref.get(app.counters);
      expect([...counters.keys()]).toHaveLength(0);
    }).pipe(Effect.provide(app.layer));
  });

  it.effect("hands back the cookies and records who signed in", () => {
    const app = firm();

    return Effect.gen(function* () {
      const cookies = yield* Effect.flatMap(IdentityService, (identity) =>
        identity.signIn(RIGHT, SOURCE),
      );

      expect(cookies).toEqual([COOKIE]);

      const recorded = yield* app.recorded;
      expect(recorded.map((entry) => entry.action)).toContain(
        "session.signed-in",
      );
    }).pipe(Effect.provide(app.layer));
  });
});

/**
 * The one-click switcher on the sign-in page (D-5).
 *
 * Everything above is built around a caller who types a password and sometimes
 * gets it wrong. This caller never does — the button carries the seeded
 * account's own password — so every press succeeds, and a control that forgives
 * every success is not a control at all. The demo bucket is the one counter in
 * the system that survives a successful sign-in, and these are the two claims
 * that make it worth having.
 */
describe("signing in through the demo switcher", () => {
  it.effect("is the same sign-in: same gateway, same audit entry", () => {
    const app = firm();

    return Effect.gen(function* () {
      const cookies = yield* Effect.flatMap(IdentityService, (identity) =>
        identity.signInAsDemo(RIGHT, SOURCE),
      );

      expect(cookies).toEqual([COOKIE]);
      expect(app.asked.times).toBe(1);

      const recorded = yield* app.recorded;
      expect(recorded.map((entry) => entry.action)).toContain(
        "session.signed-in",
      );
    }).pipe(Effect.provide(app.layer));
  });

  /**
   * The claim that matters, and the mutation that breaks it: point
   * `signInAsDemo` at `signIn` and this test fails on the very next press,
   * because `signIn` clears its own counters on the way out and would clear
   * this one too if it knew about it.
   */
  it.effect("keeps a counter that success does not clear", () => {
    const app = firm();

    return Effect.gen(function* () {
      const [allowance] = Throttle.forDemo(SOURCE);
      const allowed = allowance?.attempts ?? 0;

      const outcomes = yield* Effect.flatMap(IdentityService, (identity) =>
        Effect.forEach(Array.from({ length: allowed + 1 }), () =>
          Effect.either(identity.signInAsDemo(RIGHT, SOURCE)),
        ),
      );

      /** Every press up to the allowance signs in… */
      for (const outcome of outcomes.slice(0, allowed)) {
        expect(outcome._tag).toBe("Right");
      }

      /** …and the one after it is refused, having succeeded every time. */
      const last = outcomes[allowed];
      expect(last?._tag === "Left" ? last.left._tag : "ok").toBe(
        "TooManyAttempts",
      );

      /** The refused press never reached Better Auth. */
      expect(app.asked.times).toBe(allowed);
    }).pipe(Effect.provide(app.layer));
  });

  /**
   * Keyed on the source alone, so one visitor exhausting the roster cannot stop
   * the next one from looking at the demo — the same isolation property the
   * password buckets have, for the same reason.
   */
  it.effect("cannot spend another connection's presses", () => {
    const app = firm();

    return Effect.gen(function* () {
      const [allowance] = Throttle.forDemo(SOURCE);
      const allowed = allowance?.attempts ?? 0;

      yield* Effect.flatMap(IdentityService, (identity) =>
        Effect.forEach(Array.from({ length: allowed + 1 }), () =>
          Effect.either(identity.signInAsDemo(RIGHT, SOURCE)),
        ),
      );

      const elsewhere = yield* Effect.either(
        Effect.flatMap(IdentityService, (identity) =>
          identity.signInAsDemo(RIGHT, ELSEWHERE),
        ),
      );

      expect(elsewhere._tag).toBe("Right");
    }).pipe(Effect.provide(app.layer));
  });
});

describe("the password-reset endpoint", () => {
  const reset = new Request(
    "https://oklaw.example/api/auth/request-password-reset",
    { method: "POST" },
  );

  /**
   * A reset endpoint is an amplifier: each request is a message sent to
   * somebody who did not ask for it, so an unthrottled one costs the person
   * being harassed rather than the attacker.
   */
  it.effect("is throttled, tighter than a sign-in", () => {
    const app = firm();

    return Effect.gen(function* () {
      const [allowance] = Throttle.forReset(SOURCE);
      const allowed = allowance?.attempts ?? 0;

      const outcomes = yield* Effect.flatMap(IdentityService, (identity) =>
        Effect.forEach(Array.from({ length: allowed + 1 }), () =>
          Effect.either(identity.handle(reset, SOURCE)),
        ),
      );

      const last = outcomes[allowed];
      expect(last?._tag === "Left" ? last.left._tag : "ok").toBe(
        "TooManyAttempts",
      );
    }).pipe(Effect.provide(app.layer));
  });

  /**
   * Sign-in and sign-out are still refused here, and that refusal is a security
   * control rather than tidiness: both are audited by the operations above, and
   * a second path to the same session machinery would leave no trail. Adding a
   * throttled branch must not have opened one.
   */
  it.effect("still refuses to serve sign-in", () => {
    const app = firm();

    return Effect.gen(function* () {
      const response = yield* Effect.flatMap(IdentityService, (identity) =>
        identity.handle(
          new Request("https://oklaw.example/api/auth/sign-in/email", {
            method: "POST",
          }),
          SOURCE,
        ),
      );

      expect(response.status).toBe(404);
      expect(app.asked.times).toBe(0);
    }).pipe(Effect.provide(app.layer));
  });
});
