import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import lighthouse from "lighthouse";
import { launch } from "chrome-launcher";

/**
 * Lighthouse over the screens that matter, signed in.
 *
 * `npm run perf` measures a locally started production build; pass a base URL
 * to measure a deployment instead:
 *
 *     npm run perf -- https://law-firmmanagementsystem.vercel.app
 *
 * ## Read the Performance number with the rig in mind
 *
 * Almost every screen here reads Postgres before it can render, so its
 * Time to First Byte is a database round trip — and *where the server is*
 * decides what that costs. Measured against a build running on this machine,
 * a single `SELECT 1` to Neon in us-east-1 takes about 220ms and the dashboard
 * reads several times; measured against the deployment, where the function
 * sits beside the database, the whole root document takes 70ms.
 *
 * That is a difference between 88 and 96 in the Performance column, and none
 * of it is the application. The client-side metrics — which are the ones this
 * codebase can actually move — are identical either way. So: **measure
 * Performance against a deployment. Measure everything else anywhere.**
 */

const BASE = process.argv[2] ?? "http://localhost:3100";

const PATHS = ["/sign-in", "/dashboard", "/cases", "/billing", "/reports"];

/** Signs in the way a person does, because there is no other way in (D-5). */
async function sessionCookie() {
  const password = /DEMO_PASSWORD = "([^"]+)"/.exec(
    readFileSync("src/lib/demo.ts", "utf8"),
  )?.[1];
  if (password === undefined) throw new Error("no demo password");

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${BASE}/sign-in`);
    await page.getByLabel("Email address").fill("sarah.wanjiru@oklaw.co.ke");
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
    // The name carries a `__Secure-` prefix over HTTPS and not over http, so
    // it is read rather than assumed.
    const cookies = await page.context().cookies();
    return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  } finally {
    await browser.close();
  }
}

const cookie = await sessionCookie();
const chrome = await launch({
  chromeFlags: ["--headless=new", "--no-sandbox"],
});

try {
  const rows = [];
  for (const path of PATHS) {
    const run = await lighthouse(`${BASE}${path}`, {
      port: chrome.port,
      output: "json",
      logLevel: "error",
      // Desktop, because that is what a reviewer will open it on. The phone
      // layout has its own assertions in `e2e/responsive.spec.ts`.
      formFactor: "desktop",
      screenEmulation: { disabled: true },
      throttling: {
        rttMs: 40,
        throughputKbps: 10 * 1024,
        cpuSlowdownMultiplier: 1,
      },
      extraHeaders: { Cookie: cookie },
    });
    const report = run?.lhr;
    if (report === undefined) throw new Error(`no report for ${path}`);
    const score = (id) => Math.round((report.categories[id]?.score ?? 0) * 100);
    rows.push({
      path,
      performance: score("performance"),
      accessibility: score("accessibility"),
      "best practices": score("best-practices"),
      seo: score("seo"),
      ttfb: report.audits["server-response-time"]?.displayValue ?? "-",
      lcp: report.audits["largest-contentful-paint"]?.displayValue ?? "-",
      cls: report.audits["cumulative-layout-shift"]?.displayValue ?? "-",
    });
  }
  console.table(rows);

  const under = rows.filter((r) =>
    ["accessibility", "best practices", "seo"].some((k) => r[k] < 95),
  );
  if (under.length > 0) {
    console.error("Below 95:", under.map((r) => r.path).join(", "));
    process.exitCode = 1;
  }
} finally {
  await chrome.kill();
}
