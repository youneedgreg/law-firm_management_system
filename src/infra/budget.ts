import { Duration, Effect } from "effect";

/**
 * How long anything outside this process is given to answer.
 *
 * ## The failure this exists to prevent
 *
 * Every call in `infra/` crosses a network: Postgres over a pool, Vercel Blob
 * over HTTPS, Better Auth to the same database through a different client. Each
 * of them has a well-behaved failure — a refused connection, a 500, a closed
 * socket — and each of them has one that is not a failure at all: the other end
 * accepts the request and never answers.
 *
 * That case has no error to catch. The promise simply never settles. Without a
 * budget the request stays open until the platform's own limit kills the
 * function, which is 300 seconds on Vercel, and the person on the other end
 * watches a spinner for the whole of it. Worse, the connection, the memory and
 * the concurrency slot are held that entire time, so a dependency that hangs
 * takes the application down with it rather than merely being unavailable.
 *
 * A budget converts that into a `RepositoryFailure` or a `StorageFailure` at a
 * known instant — an error the caller already knows how to render, and one the
 * retry policies can act on.
 *
 * ## Why the durations differ
 *
 * They are not one number because the calls are not one kind of thing. Signing
 * a URL is two small control-plane requests; uploading a 40 MB bundle of
 * pleadings is not; hashing a password is *deliberately* slow. A single budget
 * generous enough for the upload would let the signature hang for half a
 * minute, and one tight enough for the signature would fail every real upload.
 * Each call site states its own and says why.
 *
 * ## What a timeout does and does not do
 *
 * It stops *waiting*. `Effect.tryPromise` wraps a promise, and a promise cannot
 * be cancelled — the upload may well complete somewhere after this fiber has
 * given up on it. That is exactly why the retry policy in `sql/resilience.ts`
 * treats a timeout as "nobody knows what happened" and will not replay a write
 * on the strength of one.
 */
export const within =
  <E>(options: {
    readonly operation: string;
    readonly duration: Duration.DurationInput;
    readonly onTimeout: (detail: string) => E;
  }) =>
  <A, R>(call: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    call.pipe(
      Effect.timeoutFail({
        duration: options.duration,
        onTimeout: () =>
          options.onTimeout(
            `no answer within ${Duration.format(Duration.decode(options.duration))}`,
          ),
      }),
      /**
       * The span is here rather than at each call site because the two belong
       * together: a trace showing a five-second gap and a log line saying "no
       * answer within 5s" are the same fact, and one of them is much easier to
       * find when they share a name.
       */
      Effect.withSpan(options.operation),
    );
