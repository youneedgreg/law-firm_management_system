import {
  type ConfigError,
  Context,
  Effect,
  FiberRef,
  FiberRefs,
  HashMap,
  Layer,
  Logger,
  Option,
  Tracer,
} from "effect";
import { TelemetryConfig } from "../config";

/**
 * Where log lines go, and what carries them back to the request that produced
 * them.
 *
 * ## The correlation id is the trace id, and that is the whole trick
 *
 * The obvious way to correlate logs is to mint a request id at the edge, thread
 * it through every function, and print it. It works, it is what most codebases
 * do, and it costs a parameter on every signature — which is why in practice it
 * gets threaded through the code somebody was debugging that week and nowhere
 * else.
 *
 * There is already an identifier with exactly the right lifetime: the trace id.
 * Next opens a span for the request, Effect's spans nest inside it (see
 * `tracing.ts`), and every fiber running under that span can be asked which
 * span it is in. So the logger *reads* the id rather than being handed it —
 * nothing is threaded anywhere, and a line logged four layers down carries the
 * same id as the line logged at the boundary, including from a fiber forked
 * mid-request.
 *
 * The payoff is a two-way join: from a slow trace to the lines it wrote, and
 * from an error line to the trace that explains what led to it.
 *
 * When there is no span — a script, a test, `next build` — the annotations are
 * simply absent. An id invented for a line with no trace behind it would be an
 * id that joins to nothing, which is worse than no field at all.
 */

/**
 * The span the logging fiber is inside, if any.
 *
 * `Effect.currentSpan` is the usual way to ask this, and it is unavailable
 * here: a `Logger` is a plain function, not an Effect. What it is handed
 * instead is the fiber's `FiberRefs`, and the current span is a service in the
 * context held by `FiberRef.currentContext` — which is exactly where
 * `Effect.withSpan` puts it.
 */
const spanOf = (refs: FiberRefs.FiberRefs): Option.Option<Tracer.AnySpan> =>
  Context.getOption(
    FiberRefs.getOrDefault(refs, FiberRef.currentContext),
    Tracer.ParentSpan,
  );

/**
 * Adds `traceId` and `spanId` to whatever the wrapped logger is about to print.
 *
 * A decorator over an existing logger rather than a logger of its own, so the
 * same enrichment applies to the JSON a log drain parses and to the coloured
 * output on a laptop. Two loggers that disagree about what a line contains is a
 * difference you find out about in production.
 *
 * Exported for `logging.test.ts`, which wraps a collecting logger in it. The
 * alternative is to assert on what the layer wrote to the console, and a test
 * that reads `console.log` is a test that breaks when the sink changes rather
 * than when the correlation does.
 */
export const correlated = <Message, Output>(
  logger: Logger.Logger<Message, Output>,
): Logger.Logger<Message, Output> =>
  Logger.make((options: Logger.Logger.Options<Message>) =>
    Option.match(spanOf(options.context), {
      onNone: () => logger.log(options),
      onSome: (span) =>
        logger.log({
          ...options,
          annotations: options.annotations.pipe(
            HashMap.set("traceId", span.traceId as unknown),
            HashMap.set("spanId", span.spanId as unknown),
          ),
        }),
    }),
  );

/**
 * The application's logger, replacing Effect's default.
 *
 * `withLeveledConsole` is what decides between `console.log` and
 * `console.error`, and it is not cosmetic: Vercel classifies a line as an error
 * by the stream it arrived on, so a `logError` written to stdout is an error
 * that never shows up in the error view. Effect's own `Logger.json` writes
 * everything to `console.log`, which is the bug this line exists to avoid.
 *
 * This is the one place in the application permitted to reach the console. The
 * quality bar forbids `console.log` in committed code, and a logger is what
 * that rule presumes exists instead — the prohibition is on printing from
 * business code, not on the sink itself having a bottom.
 *
 * `ConfigError` stays in the type for the same reason `DatabaseConfig`'s does:
 * `LOG_LEVEL=verbose` is a typo, and a process that swallowed it and quietly
 * logged at `Info` would be a process whose configuration is a suggestion.
 */
export const LoggingLive: Layer.Layer<never, ConfigError.ConfigError> =
  Layer.unwrapEffect(
    Effect.gen(function* () {
      const telemetry = yield* TelemetryConfig;

      return Layer.merge(
        Logger.replace(
          Logger.defaultLogger,
          Logger.withLeveledConsole(
            correlated(
              telemetry.format === "json"
                ? Logger.jsonLogger
                : Logger.logfmtLogger,
            ),
          ),
        ),
        Logger.minimumLogLevel(telemetry.level),
      );
    }),
  ).pipe(Layer.provide(TelemetryConfig.Default));

/**
 * Whether the browser simply went away mid-response.
 *
 * Next prefetches the next route as a stream, and cancels that stream the
 * moment somebody navigates or the link leaves the viewport — which is
 * constant during ordinary use and constant in an end-to-end run, which is
 * where this was found. The framework reports the cancelled write here, and
 * reporting it at `Error` puts a steady drip of noise into the one view that
 * exists to hold real faults.
 *
 * This is the same judgement Phase 8's `reported` makes about typed failures
 * and for the same reason: nothing failed. The request was abandoned by the
 * only party who wanted it. It is still logged, at `Debug`, because a *flood*
 * of them means something else — a proxy cutting connections, a page
 * prefetching far more than it should.
 */
export const clientWentAway = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "AbortError" ||
    /closed early|aborted|ECONNRESET/i.test(error.message)
  );
};
