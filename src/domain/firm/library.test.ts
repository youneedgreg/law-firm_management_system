import { describe, expect, it } from "vitest";
import { Option, Schema } from "effect";
import {
  AdvocateId,
  CaseId,
  ClientId,
  ContactId,
  PrecedentId,
} from "../shared/ids";
import { type Contact, lastContact, mostRecent } from "./contact";
import {
  isStale,
  lastVerified,
  matching,
  needsReview,
  type Precedent,
} from "./precedent";

/**
 * The two modules behind the firm's own records.
 *
 * The contact log answers "when did we last speak to them". The precedent bank
 * answers "is this still good law". Both are lists in the prototype and both
 * have exactly one rule that makes them worth keeping.
 */

const advocate = Schema.decodeSync(AdvocateId)(
  "10000000-0000-4000-8000-000000000001",
);
const client = Schema.decodeSync(ClientId)(
  "30000000-0000-4000-8000-000000000001",
);
const matter = Schema.decodeSync(CaseId)(
  "20000000-0000-4000-8000-000000000001",
);

const at = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const contact = (n: number, occurredOn: string): Contact => ({
  id: Schema.decodeSync(ContactId)(`e0000000-0000-4000-8000-00000000000${n}`),
  clientId: client,
  caseId: Option.some(matter),
  channel: "Call",
  direction: "Outgoing",
  loggedBy: advocate,
  summary: `Call ${String(n)}`,
  occurredOn: at(occurredOn),
});

const precedent = (
  n: number,
  addedOn: string,
  reviewedOn?: string,
  fields: Partial<Precedent> = {},
): Precedent => ({
  id: Schema.decodeSync(PrecedentId)(`f0000000-0000-4000-8000-00000000000${n}`),
  title: `Precedent ${String(n)}`,
  category: "Acts",
  location: "Shared drive",
  addedBy: advocate,
  addedOn: at(addedOn),
  reviewedOn:
    reviewedOn === undefined ? Option.none() : Option.some(at(reviewedOn)),
  ...fields,
});

describe("the contact log", () => {
  it("reads most recent first", () => {
    const older = contact(1, "2026-08-01");
    const newer = contact(2, "2026-08-20");

    expect(mostRecent([older, newer])).toStrictEqual([newer, older]);
  });

  it("does not mutate what it is given", () => {
    const older = contact(1, "2026-08-01");
    const newer = contact(2, "2026-08-20");
    const given = [older, newer];

    mostRecent(given);

    expect(given).toStrictEqual([older, newer]);
  });

  /**
   * The figure a partner uses to find the clients nobody has spoken to.
   * It counts both directions — a client who rang last week has been in touch,
   * whoever picked up the telephone.
   */
  it("reports when the firm was last in touch, either way", () => {
    const outgoing = contact(1, "2026-08-01");
    const incoming: Contact = {
      ...contact(2, "2026-08-18"),
      direction: "Incoming",
    };

    expect(lastContact([outgoing, incoming])).toStrictEqual(at("2026-08-18"));
  });

  it("says nothing about a client nobody has ever contacted", () => {
    expect(lastContact([])).toBeUndefined();
  });
});

describe("the precedent bank", () => {
  const asAt = at("2026-08-21");

  /**
   * **The rule the module exists for.**
   *
   * A precedent bank's failure is not being empty; it is being stale. An
   * annotated Act from 2019 looks exactly like one from last month in a list of
   * titles, and somebody drafts from it.
   */
  it("calls an entry stale a year after it was last verified", () => {
    expect(isStale(precedent(1, "2020-01-01", "2026-06-01"), asAt)).toBe(false);
    expect(isStale(precedent(2, "2020-01-01", "2024-06-01"), asAt)).toBe(true);
  });

  /**
   * Never reviewed is not the same as reviewed when it was filed. A default of
   * `addedOn` would claim a review that never happened — but a *recently added*
   * entry is still trustworthy, so the fallback is the filing date and the
   * distinction lives in `reviewedOn` being an `Option`.
   */
  it("falls back to when it was filed, and says which it used", () => {
    const never = precedent(1, "2026-07-01");
    const reviewed = precedent(2, "2020-01-01", "2026-07-01");

    expect(lastVerified(never)).toStrictEqual(at("2026-07-01"));
    expect(Option.isNone(never.reviewedOn)).toBe(true);

    expect(lastVerified(reviewed)).toStrictEqual(at("2026-07-01"));
    expect(Option.isSome(reviewed.reviewedOn)).toBe(true);
  });

  it("does not chase an entry filed last month", () => {
    expect(needsReview([precedent(1, "2026-07-01")], asAt)).toStrictEqual([]);
  });

  it("lists the ones to check, oldest first", () => {
    const ancient = precedent(1, "2019-01-01");
    const old = precedent(2, "2023-01-01");
    const fresh = precedent(3, "2026-07-01");

    expect(
      needsReview([fresh, old, ancient], asAt).map((each) => each.id),
    ).toStrictEqual([ancient.id, old.id]);
  });

  /** Exactly a year is not yet stale; the day after is. */
  it("is exclusive at the boundary", () => {
    expect(isStale(precedent(1, "2025-08-21"), asAt)).toBe(false);
    expect(isStale(precedent(2, "2025-08-20"), asAt)).toBe(true);
  });
});

describe("searching the bank", () => {
  const bank = [
    precedent(1, "2026-01-01", undefined, {
      title: "Employment Act, 2007 (annotated)",
      category: "Acts",
    }),
    precedent(2, "2026-01-01", undefined, {
      title: "Civil Procedure Rules — pleading templates",
      category: "Legal templates",
    }),
    precedent(3, "2026-01-01", undefined, {
      title: "KRA tax objection procedure",
      category: "Precedents",
      note: "Includes the notice of objection template",
    }),
  ];

  it("returns everything for an empty query", () => {
    expect(matching(bank, "   ")).toStrictEqual(bank);
  });

  /**
   * Terms are matched independently, so "employment act" finds "Employment
   * Act, 2007" — a whole-phrase match would fail on the comma, which is the
   * kind of thing that makes people stop using a search box.
   */
  it("matches every term, in any order, ignoring punctuation between them", () => {
    expect(matching(bank, "employment act")).toHaveLength(1);
    expect(matching(bank, "act employment")).toHaveLength(1);
    expect(matching(bank, "2007 employment")).toHaveLength(1);
  });

  it("ignores case", () => {
    expect(matching(bank, "EMPLOYMENT")).toHaveLength(1);
  });

  /**
   * "Precedents" appears in no title in this bank — only as a category — so a
   * hit proves the category is searched rather than merely being present in
   * the text somewhere.
   */
  it("searches the category as well as the title", () => {
    const found = matching(bank, "precedents");

    expect(found).toHaveLength(1);
    expect(found[0]?.title).toBe("KRA tax objection procedure");
  });

  it("searches the note, where there is one", () => {
    expect(matching(bank, "notice of objection")).toHaveLength(1);
  });

  it("finds nothing rather than everything for a term that is absent", () => {
    expect(matching(bank, "conveyancing")).toStrictEqual([]);
  });
});
