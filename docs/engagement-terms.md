# Engagement terms — the points to settle before invoicing

> **This is not legal advice and it is not a contract.** It is a list of the
> decisions an agreement has to make, written in plain English, so that the
> conversation with an advocate starts from positions rather than from a blank
> page. Your client is a law firm; they will have views, and some of them will
> be better than these.

Settle **§1 before any money moves.** Everything else can follow, but ownership
cannot be unwound after the fact: a default work-for-hire arrangement in most
jurisdictions leaves the client owning what you built, and you would discover
that at the moment you tried to sell it a second time.

---

## 1. Who owns the software

**The position to take:** you retain copyright in the software. The firm
receives a licence to use it.

Specifically:

- **You own the code**, including everything written before this engagement
  began — which here is the entire system. It was built as a portfolio project
  and existed before the client did, and that is worth stating as a fact in the
  agreement rather than leaving to be inferred. The repository's own
  [LICENSE.md](../LICENSE.md) already asserts this publicly and predates any
  engagement, which is useful evidence of the position rather than a new claim
  invented at signing time.
- **The firm gets a perpetual, non-exclusive, non-transferable licence** to use
  it for their own practice. Perpetual because a practice management system they
  could lose access to is not one they can responsibly put client records into.
  Non-exclusive because that is the whole point.
- **You may reuse anything general.** Say it explicitly: the framework, the
  architecture, the domain model, bug fixes and any improvement not specific to
  this firm. Without this clause every fix you make for them is arguably theirs.
- **Work that is genuinely bespoke** — a report only they would want, an
  integration with a system only they use — can be theirs, or licensed to them
  exclusively, if they push. That is a reasonable thing to concede and it costs
  you nothing you would resell.

**What they will actually be worried about**, and the answer to each:

| Their concern                        | What resolves it                                                                                                                                         |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "What if you disappear?"             | Source escrow, or a clause releasing the source to them if you cease to support it for N days. Cheap to give, hard to refuse.                            |
| "What if you sell it to our rivals?" | You can offer a time-limited exclusivity in their city or practice area. Think hard before agreeing — this is the clause that quietly ends the business. |
| "Are we buying it or renting it?"    | Say which, in one sentence, in the first paragraph. Most disputes here start as a misunderstanding rather than a disagreement.                           |

## 2. Their data is theirs

State it separately from §1 and unambiguously. It is also the clause that makes
§1 palatable — you are keeping the software, not their files.

- All data entered into the system belongs to the firm.
- You claim no right to use it, including in aggregate, including to improve the
  product. Resist the temptation to carve out an exception; for a system holding
  privileged material there is no version of this that reads well.
- You will hold it only as long as you are engaged, and only to run the system.

## 3. Data protection

Kenya's **Data Protection Act 2019** applies, on top of advocate–client
privilege. In its terms the firm is the **data controller** and you, running
their deployment, are a **data processor**.

- [ ] A **data processing agreement** between you. It says what you may do with
      the data (run the system, nothing else), who else can see it, and what
      happens on a breach.
- [ ] Check the **ODPC registration threshold** as it currently stands and
      whether you cross it. This changes; check it rather than assuming.
- [ ] Name your sub-processors, because you have them: the hosting platform and
      the database provider both hold this data. The firm is entitled to know
      and, realistically, entitled to object.
- [ ] Agree a **breach notification window** in hours, not "promptly".
- [ ] Say where the data is stored, physically. A firm that has never asked will
      ask the first time a client asks them.

## 4. What you are on the hook for

The clause whose absence turns a first client into unpaid permanent on-call.

- **A defect** is the system not doing what it is documented to do. You fix
  those, at no charge, within an agreed window.
- **A change** is it doing something new. That is quoted separately, every time,
  even when it is small. Especially when it is small.
- **Response times**, and be honest rather than generous: what you will actually
  do at 2am on a Sunday, in writing, is worth more to both of you than a number
  you will miss. Distinguish "the system is down" from "a report is wrong".
- **Who pays for hosting.** The database, the platform, the blob storage, the
  domain. Either they are billed directly or you re-invoice at cost — both are
  fine, and the argument is always about which one you never agreed.
- **What ends the arrangement**, on either side, with how much notice.

## 5. Getting out

Write the exit while everyone is enthusiastic. It is what makes a cautious firm
sign, and it costs almost nothing to promise.

- On termination, for any reason, they receive **a complete dump of their data**
  in a documented, non-proprietary format within an agreed number of days.
- Their data is then deleted from your systems, and you confirm that in writing.
- Say whether the licence in §1 survives termination. If they have paid for a
  perpetual licence it should — otherwise "perpetual" meant nothing.

---

## Before you send anything

- [ ] §1 settled in writing, before the first invoice
- [ ] A data processing agreement drafted (§3)
- [ ] Support and scope written down, including who pays for hosting (§4)
- [ ] The exit terms written down (§5)
- [ ] All of it read by an advocate who is **not** your client — they cannot
      advise you on an agreement they are the other party to, and asking puts
      them in an awkward position
