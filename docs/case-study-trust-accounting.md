# Case study: one rule about client money, in four places

**The problem in one sentence.** An advocate holding money for a client may not
pay out more than that client's own balance — and getting it wrong is not a bug
report, it is a disciplinary matter under the Advocates Act.

This is an account of how one rule ended up expressed in a domain function, a
database trigger, a repository translation and a transaction ordering, and why
none of those four could be removed.

---

## 1. The rule is narrower than it first looks

Rule 10 of the Advocates (Accounts) Rules (LN 137/1966) says an advocate shall
not withdraw

> any sum in excess of the amount held for the time being in such account for
> the credit of the client.

The load-bearing words are _the client_, singular. A firm holding KES 5,000,000
across twenty clients in one pooled account may not pay out KES 300,000 on
behalf of a client whose own balance is KES 200,000 — even though the bank would
honour the cheque without hesitating, and even though the firm's client account
is comfortably in credit.

That distinction is the entire problem. The naive implementation — check the
account balance before paying out — is not a weaker version of the rule. It is a
different rule, it passes every test you would think to write, and it is wrong
in exactly the case the rule exists to prevent: one client's money paying
another client's disbursement.

So the ledger is keyed by client, and there is no such thing as "the firm's
trust balance" anywhere in the domain.

## 2. What the type system can do, and where it stops

Three decisions in `src/domain/trust/ledger.ts` come straight out of the rules,
and each is a type rather than a comment.

**The balance is derived, never stored.** A stored balance can disagree with its
own history, and this is precisely the number that must not. Every figure in the
system is reconstructable from the movement list.

**Amounts are always positive; direction comes from the reason.** Signed amounts
would let a "deposit" of minus five thousand pass every type check in the system
while quietly emptying an account.

**Withdrawal reasons are a closed union**, because Rule 9 permits withdrawals
only for enumerated purposes. A free-text memo would make "why did this money
move" a question about somebody's typing.

With that, the withdrawal function is honest about failing:

```ts
export const recordWithdrawal = (
  movements: readonly TrustMovement[],
  request: WithdrawalRequest,
): Either.Either<
  readonly TrustMovement[],
  TrustAccountUnderfunded | NotAWithdrawal
>;
```

Both failures are in the signature, so a caller that ignores either does not
compile. `TrustAccountUnderfunded` carries the client, what was held and what
was asked for, so the screen can say _why_ rather than "operation failed"; and
`NotAWithdrawal` exists because a "withdrawal" whose reason pays money **in** is
a different mistake and should not be reported as insufficient funds.

And this is where the type system stops. `recordWithdrawal` is a pure function
of a list of movements, which means it is correct about a list somebody read a
moment ago.
Two requests that each read a balance of 200,000 both pass, and together they
overdraw the client. Nothing in the domain layer can see that, because the race
is not in the rule — it is in the gap between reading and writing.

## 3. Why it is a trigger, and why that is not a cop-out

The obvious next move is a `CHECK` constraint. It cannot work: this rule needs
the sum of every _other_ row for the same client, and a `CHECK` sees one row.

The next move after that is to do the check inside the application's
transaction. That closes the race only if every writer remembers to, which is a
guarantee that lasts until the second writer — a migration, an import script, a
psql session at two in the morning, or a service written next year by somebody
who has not read `src/domain/`.

So Rule 10 is enforced by a trigger:

```sql
PERFORM 1 FROM clients WHERE id = NEW.client_id FOR UPDATE;

SELECT coalesce(sum(trust_signed_amount(reason, amount_cents)), 0)
  INTO held FROM trust_movements WHERE client_id = NEW.client_id;

IF NEW.amount_cents > held THEN
  RAISE EXCEPTION 'Advocates (Accounts) Rules r.10: cannot withdraw % cents …'
    USING ERRCODE = 'check_violation';
END IF;
```

`FOR UPDATE` on the **client** row is what makes it correct rather than merely
present. It serialises withdrawals per client, so the second one sees the
first's effect — and it locks per client rather than per table, so two different
clients' withdrawals do not queue behind each other.

Triggers deserve their reputation: they are invisible in the application's
source, they surprise people, and business logic scattered into them is how a
schema becomes unmaintainable. The argument for this one is narrow and, I think,
sound. The rule is a legal obligation about money that is not the firm's; the
cost of a breach is professional rather than technical; and the check and the
write must be a single operation. That combination is rare, and it is exactly
what a trigger is for. Nothing else in this schema has one for a business rule.

## 4. The trigger creates a new problem, one layer up

A breach now arrives at the application as a `SqlError` carrying a plpgsql
string. That is the wrong shape for anyone to handle. A service should be
matching on `TrustAccountUnderfunded`, not string-matching Postgres output, and
certainly not learning that a trigger exists.

So the repository translates:

```ts
Effect.catchTag("SqlError", (error) =>
  isRule10Violation(error)
    ? asUnderfunded(movement)
    : Effect.fail(failure("InvoiceRepository.settleFromTrust")(error)),
);
```

The detail I got wrong first: `asUnderfunded` reads the balance **after** the
refusal, never before it. Reading it first — to decide whether to attempt the
write — would reintroduce the exact race the `FOR UPDATE` exists to close, and
it would do so while looking like defensive programming. Postgres stays the
arbiter; the read afterwards exists only so the error can say what the balance
was.

The recognition lives in one file (`infra/sql/rule10.ts`) because two
repositories write to `trust_movements`. Written twice, the two copies diverge
the first time somebody rewords the trigger's message.

## 5. The transaction, and the order of the two writes

Paying a fee note out of client money is two rows in different tables that are
only meaningful together: a payment against the invoice, and a withdrawal from
the client's trust balance. Either alone is a false record — the first says the
client paid when no money moved, the second says money left with nothing to show
for it.

They go in one transaction, and the withdrawal is written **last on purpose**.
It is the write Rule 10 can refuse, so putting it second means the rollback path
is the one actually exercised in production rather than the one that has never
run.

That ordering is asserted rather than assumed. Removing `withTransaction` fails
three tests, including the one that checks a refused withdrawal leaves no
payment row behind.

## 6. How it is tested

Four different kinds of check, because no one of them is sufficient.

**Exhaustive, not sampled, in the domain.** The invariant is checked over forty
interleaved withdrawals rather than a handful of examples — the space is small
enough to enumerate, so it is enumerated.

**Mutation tests on the rule itself.** Swapping the per-client check for the
firm's total balance fails exactly the two tests written for that distinction.
That is the property worth having: the difference between the right rule and the
plausible wrong one is _visible in the test suite_.

**The trigger attacked directly.** `schema.test.ts` applies the real DDL to
PGlite — Postgres compiled to WebAssembly, in-process, about a second — and then
tries to overdraw. A constraint nobody has attacked is a constraint nobody knows
works. This also caught a real defect: the trust-balance view was returning
`numeric` rather than `bigint`, which would have made it the one money column in
the schema that read back as a string.

**The seed refuses to load a breach.** After writing every fixture, the import
asks Postgres whether any client is overdrawn and fails if one is. A
demonstration dataset that ships with a rule violation baked into it teaches the
wrong thing to everyone who looks at it.

## 7. What this does not do

Stated plainly, because a case study that only lists wins is an advertisement.

There is **no bank reconciliation**. The ledger is internally consistent and says
nothing about whether the client account at the bank agrees with it, which is
the other half of what the Accounts Rules require of a real firm.

There is **one currency**. `Money` is integer minor units of KES and the type
does not carry a unit, so a second currency would be a schema change and a
domain change, not a column.

The trigger **costs a row lock per withdrawal**. At this scale that is free; at a
scale where it is not, the answer would be `SERIALIZABLE` and a retry loop, which
trades a guaranteed lock for occasional serialization failures — a different set
of trade-offs that this application does not have the traffic to justify.

And the audit trail records **that** a withdrawal happened, not the advocate's
reasoning for it. Rule 9's enumerated purposes are as close as the model gets to
intent.

---

**The generalisable part.** The rule appears in four places, and each placement
answers a different question: the domain says what the rule _is_, the trigger
makes it _true_ under concurrency, the repository makes the refusal _legible_ to
the application, and the transaction ordering makes the failure path the one
that actually runs. Removing any of the four leaves a system that is correct in
testing and wrong at three in the afternoon on a busy Friday.
