import { Option } from "effect";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DEMO_PASSWORD } from "@/lib/demo";
import { isDemoDeployment } from "@/runtime/deployment";
import { principal } from "@/runtime/session";
import { DemoAccounts } from "./DemoAccounts";
import { SignInForm } from "./SignInForm";

export const metadata: Metadata = {
  title: "Sign in · OKLaw",
};

/**
 * The way in.
 *
 * Somebody who is already signed in is sent on rather than shown the form
 * again — arriving here with a live session almost always means a bookmark or
 * a back button, and a second sign-in page is a good way to make a person doubt
 * whether the first one worked.
 *
 * The demo credentials are printed on the page. That is a deliberate choice for
 * a portfolio deployment and would be indefensible in a real one: this database
 * holds seeded fixtures for a firm that does not exist, and a reviewer who has
 * to email for a password is a reviewer who closes the tab. It is stated here,
 * in the code, rather than being something to notice and wonder about.
 *
 * Which is why the whole panel is conditional (D-11). On a firm's installation
 * this page is the form and nothing else — no roster, no password, no mention
 * that either ever existed. The condition is `isDemoDeployment()` rather than a
 * hand-maintained list of what to hide, so a role added to the roster later
 * cannot arrive on a client's sign-in page by being forgotten about.
 *
 * Hiding it is presentation, not protection: `signInAs` refuses on its own, for
 * the reasons written above it. This is what stops a client's staff reading
 * about a demonstration they are not part of.
 */
export default async function SignInPage({
  searchParams,
}: PageProps<"/sign-in">) {
  if (Option.isSome(await principal())) redirect("/dashboard");

  const { next } = await searchParams;
  const demo = await isDemoDeployment();

  return (
    <main className="signin">
      <div className="signin-card card elev-sm">
        <div className="card-kicker">OKLaw</div>
        <h1 style={{ fontSize: 30, margin: "0 0 var(--space-2)" }}>Sign in</h1>
        <p className="page-subtitle" style={{ marginBottom: "var(--space-4)" }}>
          Matters, clients and client money for the firm.
        </p>

        <SignInForm next={typeof next === "string" ? next : ""} />

        {demo && (
          <div className="signin-demo">
            <strong>Demo accounts</strong>
            <p>
              Every seeded account uses the password{" "}
              <code>{DEMO_PASSWORD}</code>, and the addresses are on the
              firm&rsquo;s pattern — <code>sarah.wanjiru@oklaw.co.ke</code> for
              the managing partner. The buttons below fill both in. Read down
              them: each role can do strictly less than the one above it.
            </p>

            <DemoAccounts next={typeof next === "string" ? next : ""} />
          </div>
        )}
      </div>
    </main>
  );
}
