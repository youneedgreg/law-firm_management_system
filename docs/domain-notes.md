# Domain notes — Kenyan legal practice

Research behind the domain model (ROADMAP Phase 1, [ADR 0005](adr/0005-model-the-kenyan-legal-domain-specifically.md)).
Every rule encoded in `src/domain/` should be traceable to an entry here.

**Status of each entry is marked explicitly.** ✅ means checked against the
primary text on Kenya Law or an equivalent official source, with the quote or
figure reproduced below. ⚠️ means gathered from secondary sources and still
needing verification before anything depends on it. This distinction matters:
this repository is public, and a confidently wrong statement about Kenyan
procedure is worse than an admitted gap.

**Nobody here is an advocate.** These notes exist to make the software model
defensible, not to state the law. Where the model simplifies, it says so.

---

## 1. Court hierarchy and pecuniary jurisdiction

### 1.1 Magistrates' courts — civil pecuniary limits ✅

Magistrates' Courts Act, No. 26 of 2015 (Cap. 10), **section 7(1)**, as at the
31 December 2022 revision. A magistrate's court has civil jurisdiction where the
value of the subject matter does not exceed:

| Rank                        | Limit (KES) |
| --------------------------- | ----------- |
| Chief Magistrate            | 20,000,000  |
| Senior Principal Magistrate | 15,000,000  |
| Principal Magistrate        | 10,000,000  |
| Senior Resident Magistrate  | 7,000,000   |
| Resident Magistrate         | 5,000,000   |

**Section 7(2)** lets the Chief Justice revise these by notice in the Gazette,
"taking into account inflation and change in prevailing economic conditions."

**Section 7(3)**: jurisdiction over claims under customary law — land held under
customary tenure, marriage, divorce, succession — is _not_ limited by value.

> **Modelling consequence.** The limits are legislated but revisable, so they are
> data, not constants baked into a type. `MagistrateRank` is a closed union; the
> KES figure attached to each rank lives in one table that can be superseded.
> And because customary-law matters escape the limit entirely, the jurisdiction
> check takes the matter type as well as the amount — a pure value comparison
> would wrongly reject them.

Source: [Kenya Law — Magistrates' Courts Act](https://new.kenyalaw.org/akn/ke/act/2015/26/eng@2022-12-31)

### 1.2 Superior courts ⚠️

Supreme Court, Court of Appeal, High Court, and the two courts of equal status
to the High Court — the Employment and Labour Relations Court, and the
Environment and Land Court. Established by Articles 162–165 of the Constitution
of Kenya 2010.

**Not yet verified against the constitutional text**, and the High Court's
divisions (Commercial and Tax, Family, Judicial Review, Constitutional and Human
Rights, Civil, Criminal) are an organisational arrangement of the Judiciary
rather than a statutory list. Confirm before the model treats division as a
closed set.

---

## 2. Client money and trust accounting

### 2.1 The Advocates (Accounts) Rules ✅

Legal Notice 137 of 1966, as at the 31 December 2022 revision. Four rules matter
to the model:

- **Rule 2 — "client account"**: a current or deposit account at a bank,
  building society or financial institution "in the name of the advocate but in
  the title of which either the word 'client' or the word 'trust' appears."
- **Rule 2 — "client's money"**: money held or received on behalf of a person
  the advocate acts for, _including_ deposits against fees to be earned, but
  excluding money belonging solely to the advocate and fees already agreed.
- **Rule 4**: an advocate "shall without delay pay into a client account all
  client's money held or received by him."
- **Rule 9**: enumerates the permitted withdrawals — payments to the client,
  payments on the client's behalf, transfers, reimbursement, and costs where a
  bill has been delivered.
- **Rule 10**: "In no circumstances may an advocate withdraw from a client
  account any sum in excess of the amount held for the time being in such
  account for the credit of the client."

> **Modelling consequence.** Rule 10 is the single most important invariant in
> this system, and it is per-client, not per-account: a firm-level positive
> balance does not authorise an overdraw against one client's ledger. So the
> trust ledger is keyed by client, a withdrawal returns
> `Either<TrustAccountUnderfunded, …>` rather than throwing, and the balance is
> derived from movements rather than stored as a mutable field — a stored
> balance can drift from its history, and this is the number that must not.
>
> Rule 9 says withdrawals are permitted only for enumerated purposes, so a
> movement carries a reason from a closed union rather than a free-text memo.

Source: [Kenya Law — Advocates (Accounts) Rules](https://kenyalaw.org/akn/ke/act/ln/1966/137/eng@2022-12-31)

---

## 3. Limitation periods

### 3.1 Limitation of Actions Act — section 4 ✅

Cap. 22 (Act No. 21 of 1968). Time runs from the date the cause of action
accrued.

| Action              | Period    | Provision        |
| ------------------- | --------- | ---------------- |
| Founded on contract | 6 years   | s. 4(1)(a)       |
| Founded on tort     | 3 years   | s. 4(2)          |
| Libel or slander    | 12 months | s. 4(2), proviso |

**Section 27** allows extension of the tort period where the plaintiff was
ignorant of material facts — so a computed limitation date is an _advisory
prompt_, never an authority to close a matter.

> **Modelling consequence.** The deadline calculator returns a date plus the
> provision it came from, so the UI can cite its reasoning rather than showing a
> bare date the advocate has to take on trust. Extension under s. 27 is
> discretionary and fact-dependent; the model does not attempt it.

Sources: [Kenya Law — Limitation of Actions Act](https://new.kenyalaw.org/akn/ke/act/1968/21) ·
[Section 4 text](https://www.sheriaplex.com/kenya-acts/5332-section-4-of-limitation-of-actions-act-cap-22-actions-of-contract-and-tort-and-certain-other-actions)

### 3.2 Procedural timelines ⚠️

Filing, service, and appeal timelines under the Civil Procedure Rules 2010 are
**not yet researched**. Needed before any "days to respond" or "appeal window"
computation. Court vacation and holidays also affect reckoning and are not yet
covered.

---

## 4. Identifiers

### 4.1 KRA PIN ⚠️

Eleven characters: one uppercase letter, nine digits, one uppercase trailing
letter — `A012345678Z`. The leading letter is `A` for individuals and `P` for
non-individual entities.

Gathered from secondary sources (tax-guide sites), **not** from a KRA
specification. The letter/digit shape is consistent across sources and safe to
validate against; **treat the trailing letter as opaque** — no checksum
algorithm has been verified, so do not implement one.

Sources: [KRA — About PIN](https://www.kra.go.ke/individual/individual-pin-registration/learn-about-pin/about-pin) ·
[org-id.guide KE-KRA](https://org-id.guide/list/KE-KRA)

### 4.2 Kenyan mobile numbers ⚠️

E.164 form `+254` followed by nine digits, mobile prefixes beginning `7` or `1`.
Not verified against a Communications Authority numbering plan. Validate the
shape; do not infer the network operator from the prefix.

---

## 5. Conflicts of interest ⚠️

The Law Society of Kenya Code of Standards of Professional Practice and Ethical
Conduct defines a conflict as an interest giving rise to a **substantial risk**
that the advocate's representation of a client "will be materially and adversely
affected" by the advocate's own interests, or by duties owed to another current
client, a former client, or a third person.

The general rule: an advocate should not knowingly assume or remain in a
position where a client's interests conflict with those of the advocate, the
firm, or another client. The code covers both the "materially limited
representation" case and the risk of using information obtained from a current
or former client to that person's disadvantage.

Read from secondary summaries of the code, not the gazetted text — marked ⚠️
until the LSK PDF is checked directly.

> **Modelling consequence, and it is the important one.** The test is
> "substantial risk" of representation being "materially and adversely
> affected". That is a judgement, and judgement is not a thing software gets to
> make. So the model **screens**, it does not **decide**.
>
> `screen()` returns a list of findings, each naming what was matched and why it
> might matter. It never returns a boolean, and it never returns "clear" —
> an empty result means _nothing was found in the records searched_, which is a
> statement about the records, not about the conflict. The distinction is
> encoded in the return type so a caller cannot collapse it into a green tick.

Source: [LSK Code of Conduct](https://lsk.or.ke/wp-content/uploads/2023/11/LSK-Code-of-Conduct-1.pdf)

---

## 6. Open questions

Carry these forward rather than guessing:

1. Civil Procedure Rules 2010 — filing, service, and appeal timelines (§3.2).
2. Court vacation and public holidays, and whether they extend reckoning.
3. High Court divisions — organisational or statutory? (§1.2)
4. The gazetted LSK code text, to replace the secondary sources behind §5.
5. VAT treatment of legal fees and disbursements, for invoice modelling.
