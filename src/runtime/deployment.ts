import { Effect } from "effect";
import { DeploymentConfig } from "../infra/config";

/**
 * Whether the code answering this request is the public demonstration (D-11).
 *
 * `DeploymentConfig` is where the variable is read and where the reasoning
 * about its default lives. This is the shape the framework can use: a promise
 * of a boolean, callable from a Server Component or a Server Action without
 * either of them having to know what a `Layer` is.
 *
 * ## It is not provided through `AppLayer`, deliberately
 *
 * Adding it there would put a demonstration flag into the context of every
 * repository and service in the system, and the point of Phase A is the
 * opposite: the demo affordances live at the edge, in the three places that
 * render or mint them, and nothing in `services/` or `domain/` has any idea
 * this distinction exists. A service that could ask "am I a demo?" is a service
 * that could one day answer differently, and then the demo would no longer be
 * the same application.
 *
 * The layer is built per call rather than memoised. It reads one environment
 * variable and allocates nothing; the alternative is a second cached runtime to
 * reason about, for a saving nobody could measure.
 *
 * ## It can reject, and every caller treats that the same way
 *
 * `Config.boolean` refuses a value it cannot read — `DEMO_DEPLOYMENT=True` is
 * not `true`, it is a failure — and that failure is deliberately *not* caught
 * here. Swallowing it into `false` would mean a typo silently stripped the
 * switcher off the demo, leaving a portfolio deployment that looks broken to a
 * reviewer and healthy to its logs.
 *
 * A rejection is safe in every direction that matters, because of where it can
 * happen: only a deployment that is *trying* to be a demo ever sets this
 * variable at all, so only a deployment that is trying to be a demo can typo
 * it. The client's installation leaves it unset, takes the default, and cannot
 * reach this failure. So the loud answer costs a broken sign-in page on the
 * demo — which is noticed and fixed in minutes — and buys a failure that says
 * what is wrong.
 *
 * Set it lowercase. `true`, `yes`, `on` and `1` are all accepted; their
 * capitalised spellings are not.
 */
export const isDemoDeployment = (): Promise<boolean> =>
  Effect.runPromise(
    DeploymentConfig.pipe(
      Effect.provide(DeploymentConfig.Default),
      Effect.map((config) => config.isDemo),
    ),
  );
