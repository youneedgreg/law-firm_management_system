import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { ROLES } from "../../domain/firm/advocate";
import { DEMO_ACCOUNTS, demoAccount } from "../../lib/demo";
import { advocates, clients, PORTAL_CLIENT_NUMBER } from "./prototype";

/**
 * The sign-in page's roster, checked against the accounts the seed provisions.
 *
 * ## What this is guarding against
 *
 * The switcher's failure mode is silence. A button for an address the seed does
 * not create looks exactly like a button that works — until somebody presses
 * it, on the deployment, and gets a refusal that reads as the demo being
 * broken. Nothing else in the system would notice: the roster is a list of
 * strings in `lib/`, and the accounts are built from the wireframe's fixtures
 * three directories away.
 *
 * Two directions, and the second is the one that catches drift. Every address
 * on the roster must be an account the seed writes, *with the role claimed
 * beside it* — and every role the firm actually employs must have a button, so
 * that a role added to `STAFF` is either represented or deliberately removed
 * from the union it is checked against, rather than quietly absent from the one
 * page that demonstrates what roles mean here.
 *
 * No database, no container: `advocates()` and `clients()` are pure functions
 * of the fixtures, which is what makes the check cheap enough to be in the
 * default suite.
 */

const staff = Either.getOrThrow(advocates());
const firmClients = Either.getOrThrow(clients());

const roster = {
  staff: DEMO_ACCOUNTS.filter((account) => account.role !== null),
  portal: DEMO_ACCOUNTS.filter((account) => account.role === null),
};

describe("the demo roster and the seed agree", () => {
  it.each(roster.staff)(
    "$label is seeded as $email, holding $role",
    (account) => {
      const person = staff.find((member) => member.email === account.email);

      expect(
        person,
        `${account.email} is not seeded by advocates()`,
      ).toBeDefined();
      expect(person?.role).toBe(account.role);
    },
  );

  it("names one portal account, and it is the client the seed gives a login", () => {
    expect(roster.portal).toHaveLength(1);

    const client = firmClients.find(
      (candidate) => candidate.number === PORTAL_CLIENT_NUMBER,
    );

    expect(client?.email).toBe(roster.portal[0]?.email);
  });

  /**
   * The reverse direction, by *role* rather than by person. Two advocates are
   * seeded and the roster lists one, which is right — a second button for the
   * same permissions would demonstrate nothing. A role with no button would.
   */
  it("covers every role the firm employs", () => {
    const employed = new Set(staff.map((member) => member.role));
    const offered = new Set(roster.staff.map((account) => account.role));

    expect([...offered].sort()).toStrictEqual([...employed].sort());
  });

  /**
   * The roles are `Role` literals, checked here rather than by the type: the
   * roster deliberately types `role` as `string | null` so that `lib/` does not
   * import `domain/` for one field — but a typo in it would still put a button
   * on the page that no seeded account matches, and the assertion above would
   * then be the only thing standing between that and a deployment.
   */
  it("names roles the domain recognises", () => {
    for (const account of roster.staff) {
      expect(ROLES).toContain(account.role);
    }
  });

  it("sends the portal account to the portal and everyone else to the dashboard", () => {
    for (const account of DEMO_ACCOUNTS) {
      expect(account.landing).toBe(
        account.role === null ? "/portal" : "/dashboard",
      );
    }
  });

  it("gives every account a distinct key", () => {
    const keys = DEMO_ACCOUNTS.map((account) => account.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("resolving a submitted key", () => {
  it("finds the account a key names", () => {
    expect(demoAccount("finance-officer")?.email).toBe("peter@oklaw.co.ke");
  });

  /**
   * A `FormData` value is `string | File`, and an absent field is `null`. All
   * three reach here, and none of them may resolve to an account — the action
   * refuses on `undefined`, so anything this returns is signed in as.
   */
  it.each([
    ["an unknown key", "senior-partner"],
    ["an address rather than a key", "sarah.wanjiru@oklaw.co.ke"],
    ["nothing submitted", null],
    ["a file", new File([], "account")],
  ])("refuses %s", (_, submitted) => {
    expect(demoAccount(submitted)).toBeUndefined();
  });
});
