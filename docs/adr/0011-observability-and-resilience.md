# 11. Observability and resilience

**Status:** Accepted · **Date:** 2026-08-21

## Context

Seven phases produced an application that works and cannot be diagnosed. When a
page took four seconds, nothing said where the four seconds went. When a Server
Component failed, the screen showed a digest and the digest pointed at a log
entry that was never written. Fourteen Server Actions each carried their own
`console.error`, which fired only for the failures somebody had thought to
single out, and which the project's own quality bar forbids.

The infrastructure underneath makes this worse rather than better. Neon is
serverless Postgres: it scales its compute to zero after five minutes idle and
closes idle connections routinely. Neither is a fault — it is the product
working as sold — but it means the first page load after lunch can meet
`ECONNREFUSED` on a database that is perfectly healthy. Vercel Blob and Better
Auth are two more network hops with two more ways to not answer.

And the sign-in form, the one page anybody can reach without a session, had no
limit on it at all.

## Decision

Five things, wired as Layers so that none of them is a call site's
responsibility to remember.

1. **Effect's tracer is built from the globally registered OpenTelemetry
   provider**, not from one of its own. `src/instrumentation.ts` calls
   `registerOTel` before the first request is served; `TracingLive` is
   `Tracer.layerGlobal`.
2. **The correlation id is the trace id.** The logger reads the current span out
   of the fiber's `FiberRefs` and annotates every line with `traceId` and
   `spanId`. Nothing is threaded through any signature.
3. **Retry is classified by what the previous attempt did**, not by whether the
   error looks transient. Three classes — never ran, rolled back by Postgres,
   outcome unknown — and the third is replayed for reads and refused for writes.
4. **Every call that leaves this process has a time budget**, sized to what the
   call actually is, and the budget is per attempt rather than per operation.
5. **Authentication attempts are counted in Postgres, keyed on the source**, and
   no counter is keyed on an account alone.

Error tracking is `onRequestError` plus the exception OpenTelemetry already
records on the span that failed. There is no Sentry (D-10).

## Rationale

### One trace, or two useless ones

`NodeSdk.layer` is what every example uses and it would have been wrong here in
a way that is invisible until you read a trace. Next is already instrumented: it
opens a span for the request, one for the route render, one for every `fetch`. A
provider built inside `AppLayer` would export a **second, parallel** trace
containing only the Effect half — `CaseService.open` with no request above it,
and `GET /cases` with nothing underneath. Both would look correct in isolation.
Neither answers the question the trace was collected for.

`Tracer.layerGlobal` reads the provider the platform already installed, and the
nesting happens because `@effect/opentelemetry` falls back to the _active_
OpenTelemetry context when a fiber has no Effect parent span — which is exactly
the situation on the first `yield*` inside a Server Component.

Nothing here names a vendor. `registerOTel` picks its exporter from the
environment: a tracing integration configured on the Vercel project, or the
standard `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS`. With
neither set, spans are created and dropped — which is why there is no flag to
turn tracing off. A flag would be a second way for it to be silently absent.

### An id that is read rather than passed

The conventional correlation id is minted at the edge and threaded through every
function that might want it. It works, and in practice it reaches the code
somebody was debugging that week and nowhere else, because adding it to a
signature is a change to every caller.

There is already an identifier with exactly the right lifetime. A `Logger` is
handed the fiber's `FiberRefs`, the current span lives in the context those
hold, and so the logger can simply look. A line written four layers down carries
the same id as the line at the boundary; it survives a fork, which is the case a
hand-threaded id always loses; and no signature mentions it.

Outside a request the annotations are absent rather than invented. An id with no
trace behind it joins to nothing, which reads as a dropped trace rather than as
one that never existed.

### Retrying the right things, and refusing to retry the rest

"Retry on transient errors" is one small step from "post the payment twice". The
useful question is not whether an error is transient but **what the attempt that
produced it did**, and there are exactly three answers.

- **It never ran.** `08001`, `08004`, `57P03`, `53300`, `ECONNREFUSED`. The
  statement was never sent, so running it again is running it once. Safe for
  anything, including an `INSERT` that moves client money.
- **Postgres rolled it back.** `40001`, `40P01`. The server discarded the work
  and said so, so a replay is safe by definition — retrying is what those codes
  are for, and a system that surfaces `40P01` to an advocate is one that did not.
- **Nobody knows.** `ECONNRESET`, `08006`, `08007`, a timeout. The write may have
  committed and the acknowledgement been lost. **Reads are replayed, writes are
  not.** Replaying a `SELECT` costs a round trip; replaying `recordPayment`
  posts a client's M-Pesa confirmation twice and the firm finds out at
  reconciliation.

`08007` is in the third set despite sharing its SQLSTATE class with codes in the
first, which is the clearest statement of the principle: the class is not the
criterion, what the attempt might have done is.

The budget sits inside the retry rather than around it, so it is per attempt.
Around it, three attempts would share five seconds and the third would get
whatever was left — a policy that stops retrying under load, which is exactly
when it is needed. The backoff is jittered because Neon waking refuses every
connection for the same few hundred milliseconds, so an unjittered policy
retries in lockstep and stampedes a database that has just come up.

### A rate limit that is not a lockout

The mitigation everybody reaches for — lock the account after five failures — is
a denial of service delivered by the safeguard. Every advocate's address is on
the firm's website. Anyone who can read it can lock a partner out of their own
files on the morning of a hearing, five wrong passwords at a time, and clearing
the counter on success does not help because the victim can never get far enough
to succeed.

So **no counter is keyed on an account alone.** Both buckets include the source
address: source-and-account together (five attempts) stops one host working a
password list against one advocate, and source alone (twenty) stops the same
host trying one or two guesses against many addresses, which is what a stuffing
list actually looks like. An attacker exhausts their own attempts and nobody
else's.

What this does not stop is a botnet with a fresh address per attempt. Nothing
keyed on the source can, and every alternative reintroduces the lockout. What
raises that floor is a second factor, which this system does not have; it is
named here rather than left as an implication.

The counters are in Postgres because on serverless an in-process `Map` is not a
rate limit: several instances, several heaps, any of them replaced between two
requests, all of it forgotten on a deploy. The bucket is stored as a SHA-256 so
that the table counts exactly as well while not also being a list of who tried
to sign in, from where, and when — the audit trail records refused sign-ins by
address, in the place designed to hold that with retention rules to match.

### Error tracking without a second vendor

An unhandled failure already reaches two places. OpenTelemetry records the
exception on the span it failed, so it arrives at whatever traces backend is
configured, in the trace that explains what led to it. `onRequestError` writes
the digest, the message, the stack, the route and the route _type_ — render,
route handler, Server Action or proxy — as one structured line to the log drain.

Sentry would add a build-time wrapper, a client bundle and a DSN in order to
send a third copy of the same event somewhere else. Its real advantages are
grouping and alerting, and both belong to whichever backend the firm actually
watches. Adding a DSN-less SDK to tick a box would be a claim the application
does not honour — the same reasoning that kept a `documents` endpoint group out
of Phase 4.

The client error boundary stops logging entirely, and that is the subtler half.
What reaches it is not the error that happened: React replaces it with an opaque
one carrying only a digest, precisely so a server stack trace cannot be read out
of a browser console by whoever is sitting there. Printing that placeholder told
nobody anything while leaving the impression the failure had been recorded.

## Consequences

**Accepted costs:**

- Six OpenTelemetry packages join the dependency tree, none of them small. They
  are peer dependencies of `@effect/opentelemetry` and `@vercel/otel` rather
  than direct choices, and the audit is clean only after pinning
  `@opentelemetry/sdk-logs` forward of the version those packages resolve to.
- Every repository operation is now wrapped in a combinator, so a query's
  failure path passes through one more layer than it did. The names had to be
  qualified at seventy-odd call sites to make spans and log lines legible.
- A retried read can take up to fifteen seconds before it fails, where it
  previously failed in one. That is the trade the retry exists to make, and it
  is bounded and stated rather than open-ended.
- The rate limiter writes to Postgres on every authentication attempt, including
  the successful ones it then clears. On a firm of twenty people that is
  nothing; on a system with real traffic it would want a cheaper store.
- **The traces backend is not provisioned.** Two environment variables and an
  account stand between this and a live trace; nothing in the code changes.

**Gained:**

- A slow request reads top to bottom: Next's `GET /cases`, the boundary, the
  repository operation, the statements underneath it, with the retries visible
  as duration the query itself does not explain.
- Every log line inside a request joins to that trace, and every typed failure
  is reported once, at a level chosen by what kind of failure it is.
- Resilience is proven by fourteen tests that run in 323 milliseconds and
  contain no sleeps — including the one that matters most, that a write whose
  outcome is unknown is attempted exactly once.
- Sign-in is no longer free to guess at, and the limiter cannot be turned into a
  weapon against the people it protects.
