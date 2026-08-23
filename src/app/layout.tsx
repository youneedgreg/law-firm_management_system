import type { Metadata } from "next";
import { Source_Serif_4 } from "next/font/google";
import { firmIdentity } from "@/runtime/deployment";
import { RxRegistry } from "@/rx/provider";
import { THEME_KEY } from "@/rx/session";
import "@phosphor-icons/web/duotone";
import "./globals.css";

/**
 * Broadsheet sets everything in one serif — headings and body alike — with the
 * true italic loaded at body weight rather than a synthesized oblique.
 */
const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["400", "600", "700"],
  display: "swap",
});

/**
 * The tab title and the description, named for whoever this installation is
 * for (D-12).
 *
 * `generateMetadata` rather than a `metadata` constant because the firm's name
 * is read at request time — a constant is evaluated once at module load, which
 * is fine for a value baked into the build and wrong for one that comes from
 * the environment the way `BETTER_AUTH_URL` does.
 *
 * The wordmark goes in the title and the full legal name in the description.
 * A browser tab is about eight visible characters wide, and "Kimani, Otieno &
 * Partners Advocates — Law Firm Management System" is a tab that reads
 * "Kimani, O…". The description has room and is where a name should be given
 * in full.
 */
export async function generateMetadata(): Promise<Metadata> {
  const firm = await firmIdentity();

  return {
    title: `${firm.shortName} — Law Firm Management System`,
    description:
      "Case, client, court, document, billing and trust management for " +
      `${firm.name}.`,
  };
}

/**
 * Applies a stored palette choice before anything is drawn.
 *
 * It has to be inline and it has to be synchronous. Every other way of doing
 * this — an effect, an atom, a layout read — runs *after* the first paint, so
 * somebody who chose dark gets a white page for a frame on every navigation
 * into the app. That flash is the entire problem, and a blocking script in
 * `<head>` is the only thing that happens early enough to prevent it.
 *
 * It reads the same key `rx/session.ts` writes, imported rather than repeated,
 * because a typo here would be silent: the page would just always start in the
 * system palette and settle a moment later, which is the bug this prevents.
 *
 * A stored value this build does not recognise is ignored, leaving the
 * attribute absent — which is `system`, and the right thing to fall back to.
 */
const applyTheme = `
try {
  var t = JSON.parse(localStorage.getItem(${JSON.stringify(THEME_KEY)}));
  if (t === "dark" || t === "light") document.documentElement.dataset.theme = t;
} catch (e) {}
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    /*
      `suppressHydrationWarning` is load-bearing here rather than a silencer,
      and it is the exact cost of the script below.

      The server cannot know which palette this browser chose — the choice is
      in `localStorage`, which only exists in the browser — so the HTML it
      sends has no `data-theme`, the script adds one before React starts, and
      React finds an attribute on the element it did not render. It reports
      that and *keeps* the attribute, which is the outcome wanted; without
      this the console carries a mismatch error on every load in development.

      It applies to this element's own attributes and not to any descendant,
      so nothing inside the page is being excused.
    */
    <html lang="en" className={sourceSerif.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: applyTheme }} />
      </head>
      <body>
        <RxRegistry>{children}</RxRegistry>
      </body>
    </html>
  );
}
