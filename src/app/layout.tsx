import type { Metadata } from "next";
import { Source_Serif_4 } from "next/font/google";
import { RxRegistry } from "@/rx/provider";
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

export const metadata: Metadata = {
  title: "OKLaw — Law Firm Management System",
  description:
    "Case, client, court, document, billing and trust management for OKLaw Advocates.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={sourceSerif.variable}>
      <body>
        <RxRegistry>{children}</RxRegistry>
      </body>
    </html>
  );
}
