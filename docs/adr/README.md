# Architecture decision records

Fourteen decisions, in the order they were made. Read top to bottom and they
tell one story: a wireframe with hardcoded arrays becoming a system, and the
five days on which that required committing to something that could not cheaply
be undone.

Each record follows Nygard's format — context, decision, consequences — and each
one names what was rejected, because a decision with no discarded alternative is
a preference. They are immutable once accepted: a decision that changes gets a
new record that supersedes the old one, rather than an edit that makes the past
look prescient (ADR 0001).

---

## The four that set the shape · 18 August

Made before a line of the system existed, and everything after them is a
consequence of one of them.

**[0002 — Effect as the application runtime, end to end](0002-effect-as-the-application-runtime.md)**
The largest bet in the repository, and the one with the highest cost if wrong.
Typed errors, Layers instead of a mocking framework, and virtual time in tests.
It commits the browser too, which is the unusual half.

**[0003 — Single firm, not multi-tenant SaaS](0003-single-firm-scope.md)**
A scope boundary, recorded as a decision so that its absence reads as judgment
rather than as an oversight. No `firm_id`, no row-level security, and a stated
reason.

**[0004 — Self-hosted authentication with Better Auth](0004-self-hosted-authentication.md)**
Sessions as rows in our own Postgres, so that an authorization check is a join
rather than a network call — without hand-rolling password hashing.

**[0005 — Model the Kenyan legal domain specifically](0005-model-the-kenyan-legal-domain-specifically.md)**
The decision that makes the domain layer worth reading: real court hierarchy,
the Advocates (Accounts) Rules, statutory limitation periods. It is also the
decision that required a week of reading before any code
([`domain-notes.md`](../domain-notes.md)).

Three more from the same day set the ground rules rather than the architecture:
**[0001](0001-record-architecture-decisions.md)** on keeping these records at
all, **[0006](0006-testing-strategy.md)** on what is tested where and why
nothing is mocked, **[0007](0007-keep-the-hand-written-design-system.md)** on
keeping the wireframe's CSS rather than reaching for a component library, and
**[0008](0008-neon-postgres-vercel-blob-and-demo-access.md)** on the
infrastructure and on being public from day one.

---

## The three that came out of building it · 19–21 August

Each of these was forced by something that only became visible once the code
existed.

**[0009 — Effect Rx for client state, not TanStack Query and Zustand](0009-effect-rx-for-client-state.md)**
Phase 5 needed state in the browser, and the default answer would have meant a
`fetch` wrapper throwing whatever it liked. An atom that runs an `Effect`
returns the same tagged failure the service produced.

**[0010 — Authorization as a typed policy layer](0010-authorization-as-a-typed-policy-layer.md)**
The one to read if you read only one. `CurrentUser` sits in the `R` channel of
every service, so an unauthorized read **does not compile** — and permission and
scope are separate checks, because a portal user genuinely holds `case:read`
and what protects the other clients is the scope.

**[0011 — Observability and resilience](0011-observability-and-resilience.md)**
Seven phases had produced an application that worked and could not be
diagnosed. Effect's spans nested inside Next's rather than beside them, the
trace id as the correlation id, and retries classified by what the previous
attempt _did_ rather than by whether the error looked transient.

---

## The three from finishing · 22 August

Polish and packaging turned out to contain real decisions rather than only
work.

**[0012 — Design tokens as primitives and roles](0012-design-tokens-as-primitives-and-roles.md)**
Extends 0007. Measuring the accumulated `color-mix()` expressions found six
contrast failures, including the primary button at 3.7:1. The split between what
a colour _is_ and what it is _for_ is what stops them accumulating again.

**[0013 — One-click demo access, without a second way in](0013-one-click-demo-access.md)**
Implements the plan in 0008, and finds that a public button which mints sessions
breaks an assumption the rate limiter was built on.

**[0014 — Documentation that fails the build when it lies](0014-documentation-that-fails-the-build.md)**
The record that makes the rest of these worth trusting: a document stating a
fact about the code is generated from it or checked against it by a test.

---

## Index

| #                                                          | Decision                                           | Date   | IDs           |
| ---------------------------------------------------------- | -------------------------------------------------- | ------ | ------------- |
| [0001](0001-record-architecture-decisions.md)              | Record architecture decisions                      | 18 Aug | —             |
| [0002](0002-effect-as-the-application-runtime.md)          | Effect as the application runtime, end to end      | 18 Aug | —             |
| [0003](0003-single-firm-scope.md)                          | Single firm, not multi-tenant SaaS                 | 18 Aug | D-1           |
| [0004](0004-self-hosted-authentication.md)                 | Self-hosted authentication with Better Auth        | 18 Aug | D-2           |
| [0005](0005-model-the-kenyan-legal-domain-specifically.md) | Model the Kenyan legal domain specifically         | 18 Aug | D-3           |
| [0006](0006-testing-strategy.md)                           | Testing strategy: layered, hermetic, deterministic | 18 Aug | D-7           |
| [0007](0007-keep-the-hand-written-design-system.md)        | Keep the hand-written design system                | 18 Aug | D-6           |
| [0008](0008-neon-postgres-vercel-blob-and-demo-access.md)  | Neon Postgres, Vercel Blob, and public demo access | 18 Aug | D-4, D-5, D-8 |
| [0009](0009-effect-rx-for-client-state.md)                 | Effect Rx for client state                         | 19 Aug | —             |
| [0010](0010-authorization-as-a-typed-policy-layer.md)      | Authorization as a typed policy layer              | 20 Aug | —             |
| [0011](0011-observability-and-resilience.md)               | Observability and resilience                       | 21 Aug | D-10          |
| [0012](0012-design-tokens-as-primitives-and-roles.md)      | Design tokens as primitives and roles              | 22 Aug | —             |
| [0013](0013-one-click-demo-access.md)                      | One-click demo access, without a second way in     | 22 Aug | D-5           |
| [0014](0014-documentation-that-fails-the-build.md)         | Documentation that fails the build when it lies    | 22 Aug | —             |

The `IDs` column points back at [`ROADMAP.md`](../../ROADMAP.md) §5, where the
same decisions are listed in one table with their consequences, and §8, which is
the running log these are written up from.
