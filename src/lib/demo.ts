/**
 * The shared password every seeded account uses (D-5).
 *
 * Here rather than in `infra/seed/` because two things need it and they are on
 * opposite sides of the application: the seed script sets it, and the sign-in
 * page prints it. Importing the seed module into a page would drag the whole
 * import — Better Auth, every repository, the prototype fixtures — into a
 * screen that needs one string.
 *
 * This is only safe because of what this deployment is: a demonstration over
 * fixtures for a firm that does not exist, with sign-up closed and every
 * account provisioned by the seed. A real deployment would remove this file and
 * the panel that reads it, and issue credentials the way ADR 0004 assumes.
 */
export const DEMO_PASSWORD = "oklaw-demo-2026";

/**
 * One account a visitor can sign in as, and what it is here to show.
 *
 * ## Why a roster rather than six buttons in the markup
 *
 * The switcher, the seed's own check, and the test that ties the two together
 * all need the same list, and a list written three times is a list that is
 * wrong in two places. This is the one copy: the sign-in page renders it, the
 * server action resolves a click against it, and `demo.test.ts` asserts every
 * address on it is an account the seed actually provisions, with the role
 * claimed here — because a button for an account that does not exist is a
 * button whose only behaviour is to refuse, and it would refuse silently, on a
 * deployment, to somebody who came to look at the work.
 *
 * ## `shows` is the reason each one is on the list
 *
 * Not a job title. A reviewer clicking through six roles learns nothing from
 * six dashboards that differ in the corner; what is worth seeing is the
 * *absences* — the screens a Receptionist does not get, the button a Finance
 * Officer does not have. So each entry says what to look for, and the roster is
 * ordered by how much authority it carries, most first, so that clicking down
 * it is watching the application close doors.
 *
 * There is deliberately no System Administrator: the wireframe's user list has
 * one and the firm's staff list does not, so no such person is seeded. A button
 * for them would be a claim about a role nothing in this system holds.
 */
export interface DemoAccount {
  /** What the form posts. Stable, and not an email address — see `signInAs`. */
  readonly key: string;
  readonly email: string;
  /** The `Role` this account's `advocates` row carries, or `null` for a client. */
  readonly role: string | null;
  readonly label: string;
  readonly shows: string;
  /** Where this account is sent when there is no `?next=` worth honouring. */
  readonly landing: "/dashboard" | "/portal";
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  {
    key: "managing-partner",
    email: "sarah.wanjiru@oklaw.co.ke",
    role: "Managing Partner",
    label: "Managing partner",
    shows:
      "Everything: the caseload, the client account, the audit trail — and one of only two roles that may move client money.",
    landing: "/dashboard",
  },
  {
    key: "advocate",
    email: "brian.kiptoo@oklaw.co.ke",
    role: "Advocate",
    label: "Advocate",
    shows:
      "A fee-earner. Opens and runs matters and bills for them, and cannot settle a fee note out of the client's own money — that separation of duties is deliberate.",
    landing: "/dashboard",
  },
  {
    key: "legal-assistant",
    email: "mercy@oklaw.co.ke",
    role: "Legal Assistant",
    label: "Legal assistant",
    shows:
      "The work on a matter — time, documents, tasks — and no power to open one, because intake runs a conflict check that is an advocate's professional responsibility.",
    landing: "/dashboard",
  },
  {
    key: "finance-officer",
    email: "peter@oklaw.co.ke",
    role: "Finance Officer",
    label: "Finance officer",
    shows:
      "The mirror image: the fee notes and the client account in full, and no way to move a matter through its lifecycle.",
    landing: "/dashboard",
  },
  {
    key: "receptionist",
    email: "ann@oklaw.co.ke",
    role: "Receptionist",
    label: "Receptionist",
    shows:
      "The caseload and the client list, because they answer the telephone to both, and no money at all.",
    landing: "/dashboard",
  },
  {
    key: "client",
    email: "pkamau@geninnovations.co.ke",
    role: null,
    label: "Client portal",
    shows:
      "One client's own matters, invoices and documents. Every other client's records answer not found rather than forbidden — a URL is not a way to learn the firm acts for someone.",
    landing: "/portal",
  },
];

/** The roster entry a submitted key names, if it names one. */
export const demoAccount = (key: unknown): DemoAccount | undefined =>
  typeof key === "string"
    ? DEMO_ACCOUNTS.find((account) => account.key === key)
    : undefined;
