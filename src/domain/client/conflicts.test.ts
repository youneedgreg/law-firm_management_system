import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { CaseId } from "../shared/ids";
import * as Conflicts from "./conflicts";

let sequence = 0;
const caseId = () => {
  sequence += 1;
  return Schema.decodeSync(CaseId)(
    `20000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
  );
};

const at = new Date("2026-08-19T09:00:00Z");

const matter = (
  caseNumber: string,
  parties: ReadonlyArray<{ name: string; role: Conflicts.PartyRole }>,
  closed = false,
): Conflicts.MatterRecord => ({
  caseId: caseId(),
  caseNumber,
  parties: parties.map(({ name, role }) => ({ party: { name }, role })),
  closed,
});

describe("normaliseName", () => {
  it("sees through punctuation, case, and company suffixes", () => {
    const variants = [
      "General Innovations Ltd",
      "GENERAL INNOVATIONS LIMITED",
      "General Innovations Ltd.",
      "  general   innovations  ",
    ];

    const normalised = variants.map(Conflicts.normaliseName);
    expect(new Set(normalised).size).toBe(1);
  });

  it("keeps genuinely different names apart", () => {
    expect(Conflicts.normaliseName("General Innovations")).not.toBe(
      Conflicts.normaliseName("General Insurance"),
    );
  });
});

describe("screen", () => {
  it("flags a prospective client the firm has previously acted against", () => {
    const history = [
      matter("OKL-2024-011", [
        { name: "Wanjiku Mwangi", role: "client" },
        { name: "Nairobi Metro SACCO", role: "opposing" },
      ]),
    ];

    const result = Conflicts.screen(
      { clientName: "Nairobi Metro Sacco", opposingNames: [] },
      history,
      at,
    );

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.kind).toBe("acted-against");
    expect(result.findings[0]?.caseNumber).toBe("OKL-2024-011");
  });

  it("flags an opposing party who is a current client", () => {
    const history = [
      matter("OKL-2026-005", [
        { name: "General Innovations Ltd", role: "client" },
        { name: "Zenith Distributors Ltd", role: "opposing" },
      ]),
    ];

    const result = Conflicts.screen(
      {
        clientName: "Coastal Agro Exports",
        opposingNames: ["General Innovations Limited"],
      },
      history,
      at,
    );

    expect(result.findings[0]?.kind).toBe("opposing-party-is-current-client");
  });

  it("still flags a former client, since duties survive the retainer", () => {
    const history = [
      matter(
        "OKL-2021-002",
        [
          { name: "Rift Valley Logistics Ltd", role: "client" },
          { name: "Someone Else", role: "opposing" },
        ],
        true,
      ),
    ];

    const result = Conflicts.screen(
      { clientName: "New Client", opposingNames: ["Rift Valley Logistics"] },
      history,
      at,
    );

    expect(result.findings[0]?.kind).toBe("acted-for");
    expect(result.findings[0]?.matterClosed).toBe(true);
  });

  it("puts current-client conflicts ahead of historical ones", () => {
    const history = [
      matter("OKL-2020-001", [{ name: "Acme Ltd", role: "client" }], true),
      matter("OKL-2026-030", [{ name: "Acme Ltd", role: "client" }], false),
    ];

    const result = Conflicts.screen(
      { clientName: "Someone", opposingNames: ["Acme"] },
      history,
      at,
    );

    expect(result.findings[0]?.kind).toBe("opposing-party-is-current-client");
    expect(result.findings[1]?.kind).toBe("acted-for");
  });

  it("reports every matching matter, not just the first", () => {
    const history = [
      matter("OKL-2019-001", [{ name: "Acme Ltd", role: "client" }], true),
      matter("OKL-2020-002", [{ name: "Acme Ltd", role: "client" }], true),
      matter("OKL-2021-003", [{ name: "Acme Ltd", role: "client" }], true),
    ];

    const result = Conflicts.screen(
      { clientName: "Someone", opposingNames: ["Acme Ltd"] },
      history,
      at,
    );

    expect(result.findings).toHaveLength(3);
  });

  it("gives each finding a concern an advocate can read", () => {
    const history = [
      matter("OKL-2024-011", [
        { name: "Wanjiku Mwangi", role: "client" },
        { name: "Nairobi Metro SACCO", role: "opposing" },
      ]),
    ];

    const result = Conflicts.screen(
      { clientName: "Nairobi Metro SACCO", opposingNames: [] },
      history,
      at,
    );

    expect(result.findings[0]?.concern).toContain("acted against");
  });
});

describe("what an empty result means", () => {
  /**
   * The point of the module. An empty finding list is a statement about the
   * records searched, not a determination that no conflict exists — so the
   * result carries how much was searched, and there is deliberately no
   * `isClear` or `hasConflict` to collapse it into.
   */
  it("reports nothing found, alongside how little was searched", () => {
    const result = Conflicts.screen(
      { clientName: "Nobody", opposingNames: ["No One"] },
      [],
      at,
    );

    expect(result.findings).toStrictEqual([]);
    expect(result.mattersSearched).toBe(0);
  });

  it("distinguishes a thin search from a thorough one", () => {
    const history = Array.from({ length: 40 }, (_, index) =>
      matter(`OKL-2020-${String(index).padStart(3, "0")}`, [
        { name: `Client ${index}`, role: "client" },
      ]),
    );

    const thorough = Conflicts.screen(
      { clientName: "Nobody", opposingNames: [] },
      history,
      at,
    );
    const thin = Conflicts.screen(
      { clientName: "Nobody", opposingNames: [] },
      [],
      at,
    );

    expect(thorough.findings).toStrictEqual(thin.findings);
    expect(thorough.mattersSearched).toBe(40);
    expect(thin.mattersSearched).toBe(0);
  });

  it("exposes nothing beyond the findings and what was searched", () => {
    // Pinning the shape: any future `isClear` or `hasConflict` would collapse
    // "nothing matched in these records" into "no conflict exists", which is
    // a determination this module is deliberately not entitled to make.
    const result = Conflicts.screen(
      { clientName: "Nobody", opposingNames: [] },
      [],
      at,
    );

    expect(Object.keys(result).sort()).toStrictEqual([
      "findings",
      "mattersSearched",
      "screenedAt",
    ]);
  });
});
