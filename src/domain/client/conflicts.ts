import { Schema } from "effect";
import { CaseId, ClientId } from "../shared/ids";

/**
 * Conflict-of-interest screening on client intake.
 * See docs/domain-notes.md §5.
 *
 * **This module screens; it does not decide.** The LSK test is whether there is
 * a "substantial risk" that representation "will be materially and adversely
 * affected" — a judgement about a specific retainer, made by an advocate who
 * knows the facts. Software cannot make it.
 *
 * So there is no `hasConflict(): boolean` here, and there never should be. The
 * screen returns findings: what matched, in which matter, and why it might
 * matter. An advocate reads them and decides.
 *
 * The one thing this file works hardest at is refusing to say "clear". An empty
 * finding list means *nothing matched in the records searched* — a statement
 * about the records, not about the world. `ScreeningResult` carries what was
 * searched precisely so that the difference survives into the UI, instead of
 * being flattened into a green tick that means more than it should.
 */

// ── Parties ───────────────────────────────────────────────────────────────

/**
 * A party to a matter, as recorded on the firm's file.
 *
 * `normalisedName` is what matching runs against. Names arrive punctuated and
 * capitalised inconsistently — "General Innovations Ltd.", "GENERAL
 * INNOVATIONS LIMITED" — and a screen that misses those is worse than useless
 * because it produces a confident empty result.
 */
export const Party = Schema.Struct({
  name: Schema.String,
  /** Present when the party is, or was, a client of the firm. */
  clientId: Schema.optional(ClientId),
});

export type Party = typeof Party.Type;

export const PARTY_ROLES = ["client", "opposing", "interested"] as const;
export const PartyRole = Schema.Literal(...PARTY_ROLES);
export type PartyRole = typeof PartyRole.Type;

/** A matter as the screen sees it: who was involved, on which side, and when. */
export interface MatterRecord {
  readonly caseId: CaseId;
  readonly caseNumber: string;
  readonly parties: ReadonlyArray<{
    readonly party: Party;
    readonly role: PartyRole;
  }>;
  readonly closed: boolean;
}

// ── Findings ──────────────────────────────────────────────────────────────

export const FINDING_KINDS = [
  /** The firm has acted *against* this party before. */
  "acted-against",
  /** The firm has acted *for* this party before — a former or current client. */
  "acted-for",
  /** A proposed opposing party is a current client of the firm. */
  "opposing-party-is-current-client",
] as const;

export const FindingKind = Schema.Literal(...FINDING_KINDS);
export type FindingKind = typeof FindingKind.Type;

export interface ConflictFinding {
  readonly kind: FindingKind;
  readonly party: string;
  readonly caseId: CaseId;
  readonly caseNumber: string;
  readonly matterClosed: boolean;
  /** Why this might engage the code — for the advocate, not the machine. */
  readonly concern: string;
}

const CONCERNS: Readonly<Record<FindingKind, string>> = {
  "acted-against":
    "The firm has acted against this party. Information obtained then could be used to their disadvantage now.",
  "acted-for":
    "This party is or was a client. Duties to a former client survive the retainer.",
  "opposing-party-is-current-client":
    "The proposed opposing party is a current client. Acting would put the firm directly against its own client.",
};

/**
 * What was screened, alongside what was found.
 *
 * The `mattersSearched` count is not decoration. "No findings across 1,240
 * matters" and "no findings across 3 matters" are very different statements,
 * and only one of them is worth much.
 */
export interface ScreeningResult {
  readonly findings: readonly ConflictFinding[];
  readonly mattersSearched: number;
  readonly screenedAt: Date;
}

// ── Matching ──────────────────────────────────────────────────────────────

const SUFFIXES = [
  "ltd",
  "limited",
  "plc",
  "llp",
  "company",
  "co",
  "inc",
  "incorporated",
  "sacco",
  "society",
];

/**
 * Reduces a name to something comparable: lowercase, unpunctuated, with common
 * company suffixes removed.
 *
 * Deliberately blunt. This is a screen, and its job is to over-report rather
 * than under-report — a false positive costs an advocate ten seconds, while a
 * false negative is the failure the whole exercise exists to prevent.
 */
export const normaliseName = (name: string): string => {
  const base = name
    .toLowerCase()
    .replace(/[.,'"()]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const words = base.split(" ").filter((word) => !SUFFIXES.includes(word));
  return words.join(" ");
};

const sameParty = (a: string, b: string): boolean =>
  normaliseName(a) === normaliseName(b);

// ── The screen ────────────────────────────────────────────────────────────

export interface IntakeEnquiry {
  /** The prospective client. */
  readonly clientName: string;
  /** Parties the prospective client would be against. */
  readonly opposingNames: readonly string[];
}

/**
 * Screens a prospective retainer against the firm's matter history.
 *
 * Returns everything it matched. Ordering puts current-client conflicts first,
 * since those are the ones most likely to be disqualifying, but no finding is
 * filtered out on the model's own authority.
 */
export const screen = (
  enquiry: IntakeEnquiry,
  history: readonly MatterRecord[],
  screenedAt: Date,
): ScreeningResult => {
  const findings: ConflictFinding[] = [];

  const record = (
    kind: FindingKind,
    party: string,
    matter: MatterRecord,
  ): void => {
    findings.push({
      kind,
      party,
      caseId: matter.caseId,
      caseNumber: matter.caseNumber,
      matterClosed: matter.closed,
      concern: CONCERNS[kind],
    });
  };

  for (const matter of history) {
    for (const { party, role } of matter.parties) {
      // The prospective client has been on the other side of one of our matters.
      if (sameParty(party.name, enquiry.clientName) && role === "opposing") {
        record("acted-against", party.name, matter);
      }

      for (const opposing of enquiry.opposingNames) {
        if (!sameParty(party.name, opposing)) continue;

        if (role === "client") {
          record(
            matter.closed ? "acted-for" : "opposing-party-is-current-client",
            party.name,
            matter,
          );
        }
      }
    }
  }

  const severity: Readonly<Record<FindingKind, number>> = {
    "opposing-party-is-current-client": 0,
    "acted-for": 1,
    "acted-against": 2,
  };

  return {
    findings: [...findings].sort((a, b) => severity[a.kind] - severity[b.kind]),
    mattersSearched: history.length,
    screenedAt,
  };
};
